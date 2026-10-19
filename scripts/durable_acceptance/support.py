"""OS-process/HTTP/Postgres primitives for the durable generation acceptance run."""
from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import re
import secrets
import signal
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import asyncpg
import httpx
from PIL import Image

HERE = Path(__file__).resolve().parent


def free_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def wait_until(predicate, message, timeout=45):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        last = predicate()
        if last:
            return last
        time.sleep(0.04)
    raise AssertionError(f'Timeout: {message}; last observed={last!r}')


def sql(database_url, query, *args):
    async def execute():
        connection = await asyncpg.connect(database_url)
        try:
            return [dict(row) for row in await connection.fetch(query, *args)]
        finally:
            await connection.close()
    return asyncio.run(execute())


class Database:
    def __init__(self, admin_url):
        self.admin_url = admin_url
        self.name = 'flipbook_acceptance_' + secrets.token_hex(6)
        parts = urlsplit(admin_url)
        self.url = urlunsplit((parts.scheme, parts.netloc, '/' + self.name, '', ''))
        sql(admin_url, f'CREATE DATABASE "{self.name}"')

    def close(self):
        sql(self.admin_url, 'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', self.name)
        sql(self.admin_url, f'DROP DATABASE "{self.name}"')


class Server:
    def __init__(self, directory, database_url, *, port=None, gates=None, ready=True, environment=None):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.port = port or free_port()
        self.base = f'http://127.0.0.1:{self.port}'
        self.log_path = self.directory / 'server.log'
        self.log = self.log_path.open('ab')
        process_environment = {key: value for key, value in os.environ.items()
                               if key not in ('LLM_API_KEY', 'IMG_GEN_API_KEY')}
        process_environment.update(environment or {})
        self.process = subprocess.Popen([sys.executable, '-u', str(HERE / 'worker.py')], stdin=subprocess.PIPE,
                                        stdout=self.log, stderr=self.log, env=process_environment)
        self.process.stdin.write((json.dumps({'database_url': database_url, 'port': self.port,
                                             'storage': str(self.directory / 'assets'), 'gates': gates or []}) + '\n').encode())
        self.process.stdin.flush()
        self.process.stdin.close()
        if ready:
            wait_until(self.healthy, 'real Uvicorn startup', timeout=60)

    def healthy(self):
        if self.process.poll() is not None:
            raise AssertionError('Uvicorn exited at startup; see server.log')
        try:
            return httpx.get(self.base + '/api/health', timeout=0.5).status_code == 200
        except httpx.HTTPError:
            return False

    def request(self, method, path, *, expected=200, **options):
        response = httpx.request(method, self.base + '/api' + path, timeout=60, **options)
        assert response.status_code == expected, (method, path, response.status_code, response.text[:800])
        return response

    def json(self, method, path, **options):
        return self.request(method, path, **options).json()

    def snapshot(self, job_id):
        return self.json('GET', '/jobs/' + job_id)

    def wait(self, job_id, statuses, timeout=60):
        if isinstance(statuses, str):
            statuses = [statuses]
        return wait_until(lambda: (snapshot if (snapshot := self.snapshot(job_id))['status'] in statuses else False),
                          f'job status {statuses}', timeout=timeout)

    def kill(self):
        if self.process.poll() is None:
            self.process.send_signal(signal.SIGKILL)
            assert self.process.wait(timeout=10) != 0
        self.log.close()

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self.log.close()


class Provider:
    def __init__(self, *, port=None, key=None, delay=0, host='127.0.0.1'):
        self.port = port or free_port()
        self.base = f'http://127.0.0.1:{self.port}/v1'
        self.key = key or 'FAKE_ACCEPTANCE_ONLY_' + secrets.token_urlsafe(32)
        self.delay = delay
        self.calls = []
        self.failures = {}
        self.blocks = {}
        self.releases = []
        self.lock = threading.Lock()
        image = io.BytesIO()
        Image.new('RGB', (160, 100), '#316e5a').save(image, format='PNG')
        self.png = image.getvalue()
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                if self.headers.get('Authorization') != 'Bearer ' + owner.key:
                    self.send_error(401)
                    return
                if self.path != '/v1/models':
                    self.send_error(404)
                    return
                with owner.lock:
                    models = sorted({'browser_recovery_demo', *(call['case'] for call in owner.calls)})
                encoded = json.dumps({'object': 'list', 'data': [{'id': model, 'object': 'model'} for model in models]}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def do_POST(self):
                authorized = self.headers.get('Authorization') == 'Bearer ' + owner.key
                if not authorized:
                    self.send_error(401)
                    return
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                case = body['model']
                if self.path == '/v1/images/generations':
                    stage = 'image'
                    result = {'created': 100, 'data': [{'b64_json': base64.b64encode(owner.png).decode()}]}
                elif self.path == '/v1/chat/completions':
                    system = str(body['messages'][0].get('content', ''))
                    prompt = str(body['messages'][-1]['content'])
                    if '可独立阅读' in system:
                        stage = 'analysis' if '知识页素材：' in prompt else 'plan'
                        label_match = re.search(r'本页探索主题：([^\n]+)', prompt)
                        label = label_match.group(1).strip() if label_match else '水循环知识页'
                        english = '请用en写' in system
                        content = {
                            'title': 'The water cycle' if english and stage == 'analysis' else label,
                            'description': 'A connected journey of water through air and land.' if english else '水在地表和空气之间流动，能量与温度变化连接了各个过程。',
                            'layout': 'sequence', 'subject_en': 'water cycle', 'composition_type': 'diagram',
                            'sub_topics_en': ['evaporation', 'condensation', 'precipitation'],
                            'sections': [
                                {'title': 'Evaporation' if english else '蒸发', 'body': 'Sunlight supplies energy for water to evaporate. Water from oceans, soil and plants enters the air as vapor.' if english else '阳光为液态水转变成水蒸气提供能量。海洋、湖泊、土壤和植物都向空气提供水分，蒸发速度也受温度和湿度影响。'},
                                {'title': 'Condensation' if english else '凝结', 'body': 'Water vapor cools as air rises. Tiny droplets form around particles and gather into clouds in the atmosphere.' if english else '湿润空气上升并冷却后，水蒸气会在微小颗粒周围凝结。许多细小水滴或冰晶聚集，形成我们看到的云。'},
                                {'title': 'Precipitation' if english else '降水', 'body': 'Cloud droplets grow and eventually fall as rain or snow. Water then returns to rivers, soil and oceans.' if english else '云中的水滴或冰晶不断增长，达到合适条件后以雨雪等形式落下。水随后经地表径流和下渗回到河流、地下与海洋。'},
                            ],
                            # Deliberately untrusted extras must never become publication facts.
                            'references': [{'id': 'forged', 'title': 'Fabricated source', 'url': 'https://example.invalid/forged'}],
                            'provenance': {'kind': 'ai', 'model': 'forged-model'}, 'review_status': 'reviewed',
                        }
                        if case.startswith('knowledge_invalid'):
                            content['sections'] = [{'title': 'Invalid', 'body': 'too short'}]
                    elif '图像区域定位专家' in system:
                        stage = 'localize'
                        content = {'hotspots': [{'label': '可继续探索', 'x': 0.2, 'y': 0.2, 'width': 0.25, 'height': 0.3}]}
                    elif '图片内容分析专家' in system:
                        stage = 'analysis'
                        content = {'summary': case + '根页', 'scene_type': 'other', 'keywords': [], 'hotspots': [
                            {'label': '分支甲', 'x': 0.1, 'y': 0.1, 'width': 0.2, 'height': 0.2},
                            {'label': '分支乙', 'x': 0.6, 'y': 0.4, 'width': 0.2, 'height': 0.2}]}
                    elif '可深度探索的封面图' in system:
                        stage = 'analysis'
                        content = {'summary': case + '文字根页', 'subject_en': case + '_root',
                                   'composition_type': 'plate', 'main_objects': ['branch_a', 'branch_b'],
                                   'main_objects_zh': ['分支甲', '分支乙'], 'scene_type': 'other',
                                   'language_hint': 'zh', 'keywords': []}
                    else:
                        stage = 'plan'
                        label_match = re.search(r'当前探索热点：([^\n]+)', prompt)
                        label = label_match.group(1).strip() if label_match else '分支甲'
                        content = {'title': label, 'description': case + ' / ' + label, 'subject_en': case + '_' + label,
                                   'composition_type': 'plate', 'sub_topics': ['细节'], 'sub_topics_en': [case + '_detail']}
                    result = {'choices': [{'message': {'content': json.dumps(content, ensure_ascii=False)}}]}
                else:
                    self.send_error(404)
                    return
                with owner.lock:
                    owner.calls.append({'case': case, 'stage': stage})
                    failure = owner.failures.pop((case, stage), None)
                    block = owner.blocks.pop((case, stage), None)
                if block:
                    block[0].set()
                    block[1].wait(timeout=60)
                if owner.delay:
                    time.sleep(owner.delay)
                if failure == 'disconnect':
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                encoded = json.dumps(result, ensure_ascii=False).encode()
                if isinstance(failure, int):
                    # Deliberately echo the fake credential to exercise provider
                    # error redaction without persisting it in the fake server.
                    encoded = json.dumps({'error': {'message': owner.key}}).encode()
                self.send_response(failure if isinstance(failure, int) else 200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(encoded)))
                self.end_headers()
                try:
                    self.wfile.write(encoded)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.server = ThreadingHTTPServer((host, self.port), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def headers(self, case, *, image=True):
        return {'x-llm-base-url': self.base, 'x-llm-api-key': self.key, 'x-llm-model': case,
                'x-imggen-base-url': self.base, 'x-imggen-api-key': self.key if image else '', 'x-imggen-model': case}

    def count(self, case, stage):
        with self.lock:
            return sum(call == {'case': case, 'stage': stage} for call in self.calls)

    def block(self, case, stage):
        entered, release = threading.Event(), threading.Event()
        self.blocks[(case, stage)] = (entered, release)
        self.releases.append(release)
        return entered, release

    def close(self):
        for release in self.releases:
            release.set()
        self.server.shutdown()
        self.server.server_close()


def secret_in_cell(value, key):
    """Decode serialized cells without unpickling/executing database input."""
    import re
    if not isinstance(value, (str, bytes, bytearray)):
        return False, 0
    data = value.encode() if isinstance(value, str) else bytes(value)
    if key.encode() in data:
        return True, 0
    decoded_count = 0
    candidates = [data, *re.findall(rb'[A-Za-z0-9+/]{24,}={0,2}', data)]
    for candidate in candidates:
        try:
            decoded = base64.b64decode(candidate, validate=True)
        except (ValueError, TypeError):
            continue
        decoded_count += 1
        if key.encode() in decoded:
            return True, decoded_count
    return False, decoded_count


def audit(database_url, directory, keys, *, dump_command=None, require_checkpoints=True):
    """Inspect this test DB's relation bytes, logical rows, DBOS cells and logs.

    No cluster-wide WAL scan: the Docker daemon may host unrelated projects.
    Database names are unique per run, so relation files belong only to this run.
    """
    tables = sql(database_url, "SELECT table_schema, table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')")
    cells = decoded = checkpoints = 0
    logical = []
    for item in tables:
        schema, table = item['table_schema'], item['table_name']
        quoted = '"' + schema.replace('"', '""') + '"."' + table.replace('"', '""') + '"'
        rows = sql(database_url, 'SELECT * FROM ' + quoted)
        logical.append({'schema': schema, 'table': table, 'rows': rows})
        for row in rows:
            for column, value in row.items():
                cells += 1
                if column in ('inputs', 'output', 'error') and value is not None:
                    checkpoints += 1
                for key in keys:
                    found, count = secret_in_cell(value, key)
                    decoded += count
                    assert not found, f'Secret persisted in {schema}.{table}.{column}'
    logical_bytes = json.dumps(logical, default=str, ensure_ascii=False).encode()
    for key in keys:
        assert key.encode() not in logical_bytes, 'Secret in logical SQL row export'
    directory = Path(directory)
    for path in directory.rglob('*'):
        if not path.is_file():
            continue
        data = path.read_bytes()
        for key in keys:
            assert key.encode() not in data, f'Secret in raw file {path.name}'
    database_oid = sql(database_url, 'SELECT oid FROM pg_database WHERE datname=current_database()')[0]['oid']
    relation_dir = 'base/' + str(database_oid)
    relations = sql(database_url, 'SELECT name FROM pg_ls_dir($1) AS name', relation_dir)
    raw_files = raw_bytes = disappeared_files = 0
    for relation in relations:
        name = relation['name']
        if not name[0].isdigit():
            continue
        # Postgres can unlink transient relation files after the directory listing
        # (for example after autovacuum). Missing files have no bytes to inspect.
        raw = sql(database_url, 'SELECT pg_read_binary_file($1, true) AS data', relation_dir + '/' + name)[0]['data']
        if raw is None:
            disappeared_files += 1
            continue
        raw_files += 1
        raw_bytes += len(raw)
        for key in keys:
            assert key.encode() not in raw, 'Secret in raw Postgres relation file'
    dumped = False
    if dump_command:
        dump = subprocess.check_output([*dump_command, '--no-owner', '--no-privileges', urlsplit(database_url).path.lstrip('/')])
        for key in keys:
            assert key.encode() not in dump, 'Secret in pg_dump SQL'
        (directory / 'database.sql').write_bytes(dump)
        dumped = True
    # A browser demo can close before submitting a task. Its empty database
    # still gets the same row/file scan and serialized negative control, but
    # only a completed process acceptance run must contain real checkpoints.
    if require_checkpoints:
        assert checkpoints > 0 and decoded > 0
    from dbos._serialization import DefaultSerializer
    negative = DefaultSerializer().serialize({'must_be_detected': keys[0]})
    assert keys[0] not in negative
    assert secret_in_cell(negative, keys[0])[0], 'Base64 serialized negative control was missed'
    return {'tables_scanned': len(tables), 'cells_scanned': cells, 'checkpoint_cells_inspected': checkpoints,
            'base64_decoded_candidates_inspected': decoded, 'raw_postgres_relation_files_scanned': raw_files,
            'raw_postgres_relation_bytes_scanned': raw_bytes, 'worker_log_and_asset_files_clean': True,
            'raw_postgres_relation_files_disappeared_before_read': disappeared_files,
            'logical_sql_rows_clean': True, 'pg_dump_sql_clean': dumped, 'serialized_negative_control_detected': True}
