#!/usr/bin/env python3
"""Exercise the built nginx/API/Postgres stack with a local fake LLM, never a paid key.

Run while Compose is up:
  python scripts/verify_stack.py --base-url http://127.0.0.1:18080 \
    --provider-url http://host.docker.internal:19091/v1 --evidence /tmp/stack-evidence.json
The provider listens on port 19091 only for this process and returns fixed JSON.
"""
import argparse
import hashlib
import io
import json
import re
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:18080')
    parser.add_argument('--provider-url', default='http://host.docker.internal:19091/v1')
    parser.add_argument('--provider-port', type=int, default=19091)
    parser.add_argument('--evidence', type=Path)
    args = parser.parse_args()
    events = []
    counters = {'analysis': 0, 'child_success': 0, 'child_retry': 0, 'text_analysis': 0}
    expected_key = 'stack-verification-only-not-a-real-key'

    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            assert self.path == '/v1/chat/completions'
            assert self.headers.get('Authorization') == f'Bearer {expected_key}'
            payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            messages = payload['messages']
            prompt = str(messages[-1]['content'])
            system = str(messages[0].get('content', ''))
            if '当前探索热点：' in prompt or '本页探索主题：' in prompt:
                retry = '当前探索热点：重试分支' in prompt or '本页探索主题：重试分支' in prompt
                label = 'child_retry' if retry else 'child_success'
                counters[label] += 1
                if retry and counters[label] == 1:
                    # A definite rejection is a retryable failed branch. A 5xx
                    # is now deliberately paused as an unknown paid outcome.
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(b'{"error":{"message":"controlled failure"}}')
                    return
                content = {'title': '重试已恢复' if retry else '成功分支', 'description': '真实 HTTP 受控供应商生成内容',
                           'subject_en': 'water', 'composition_type': 'diagram',
                           'sub_topics': ['细节'], 'sub_topics_en': ['detail']}
            elif '可深度探索的封面图' in system or '可独立阅读' in system:
                counters['text_analysis'] += 1
                content = {'summary': '直接入口：文字分析', 'subject_en': 'water cycle', 'composition_type': 'diagram',
                           'main_objects': ['cloud', 'rain'], 'main_objects_zh': ['云', '雨'], 'keywords': []}
            else:
                counters['analysis'] += 1
                assert any(block.get('type') == 'image_url' for block in messages[-1]['content'])
                content = {'summary': '整栈验证：水循环', 'scene_type': 'other', 'keywords': [], 'hotspots': [
                    {'label': '成功分支', 'x': 0.1, 'y': 0.1, 'width': 0.2, 'height': 0.2},
                    {'label': '重试分支', 'x': 0.6, 'y': 0.4, 'width': 0.2, 'height': 0.2}]}
            if '可独立阅读' in system:
                content.update({'title': content.get('title') or content.get('summary'),
                                'description': content.get('description') or content.get('summary'),
                                'layout': 'sequence', 'sections': [
                                    {'title': '能量与变化', 'body': '阳光为液态水变成水蒸气提供能量，湖泊、海洋、土壤和植物都参与这个持续变化的过程。'},
                                    {'title': '返回地面', 'body': '水蒸气随空气上升并冷却，形成云滴或冰晶，达到合适条件后以雨雪等形式回到地表。'}]})
            body = json.dumps({'choices': [{'message': {'content': json.dumps(content, ensure_ascii=False)}}]}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    provider = ThreadingHTTPServer(('0.0.0.0', args.provider_port), Provider)
    thread = threading.Thread(target=provider.serve_forever, daemon=True)
    thread.start()
    headers = {'x-llm-base-url': args.provider_url, 'x-llm-api-key': expected_key,
               'x-llm-model': 'deterministic-verification', 'x-imggen-api-key': ''}
    projects = []

    def request(method, path, body=None, *, content_type='application/json', ai=False, expected=200):
        if isinstance(body, dict):
            body = json.dumps(body, ensure_ascii=False).encode()
        req_headers = {'Content-Type': content_type, **(headers if ai else {})}
        req = urllib.request.Request(args.base_url + path, data=body, method=method, headers=req_headers)
        try:
            response = urllib.request.urlopen(req, timeout=90)
        except urllib.error.HTTPError as exc:
            response = exc
        content = response.read()
        assert response.status in ((expected,) if isinstance(expected, int) else expected), (method, path, response.status, content[:500])
        return content, {key.lower(): value for key, value in response.headers.items()}

    def json_request(*a, **kw):
        return json.loads(request(*a, **kw)[0])

    def create(name):
        project = json_request('POST', '/api/projects', {'name': name})['project_id']
        projects.append(project)
        return project

    def wait_job(job):
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            snapshot = json_request('GET', '/api/jobs/' + job['job_id'])
            if snapshot['status'] in {'succeeded', 'partial', 'failed', 'cancelled'}:
                assert snapshot['status'] in {'succeeded', 'partial'}, snapshot
                return snapshot
            time.sleep(0.05)
        raise AssertionError('Timed out waiting for stack job ' + job['job_id'])

    def upload(project, png, *, direct=False):
        boundary = 'flipbook-verification-boundary'
        prefix = b''
        if direct:
            for key, value in {'operation_id': 'direct-upload-' + project, 'file_sha256': hashlib.sha256(png).hexdigest(), 'generate_images': 'false'}.items():
                prefix += (f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n').encode()
        body = prefix + (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="pixels.png"\r\n'
                'Content-Type: image/png\r\n\r\n').encode() + png + f'\r\n--{boundary}--\r\n'.encode()
        raw, _ = request('POST', f'/api/projects/{project}/' + ('analysis-jobs' if direct else 'analyze'), body,
                         content_type=f'multipart/form-data; boundary={boundary}', ai=True, expected=(200, 202))
        if raw.lstrip().startswith(b'{'):
            snapshot = wait_job(json.loads(raw))
            return [{'done': True, **snapshot['result']}]
        return [json.loads(line[6:]) for line in raw.decode().splitlines() if line.startswith('data: ')]

    def verify(name, condition):
        assert condition, name
        events.append({'check': name, 'passed': True})

    try:
        verify('health through nginx', json_request('GET', '/api/health') == {'status': 'ok'})
        html, _ = request('GET', '/')
        asset_paths = re.findall(rb'(?:src|href)="(/assets/[^"]+)"', html)
        verify('built SPA and assets through nginx', b'type="module"' in html and bool(asset_paths))
        for asset_path in asset_paths:
            asset, response_headers = request('GET', asset_path.decode())
            assert asset and not asset.lstrip().lower().startswith(b'<!doctype html')
            mime = response_headers.get('content-type', '')
            assert ('javascript' in mime if asset_path.endswith(b'.js') else 'text/css' in mime), mime
        request('GET', '/share/verification-route')
        project, other_project = create('Temporary stack verification'), create('Temporary ownership verification')
        buffer = io.BytesIO()
        Image.new('RGB', (120, 80), (46, 113, 141)).save(buffer, format='PNG')
        result = upload(project, buffer.getvalue())
        verify('upload and real HTTP vision analysis', any(event.get('done') for event in result))
        graph = json_request('GET', f'/api/projects/{project}')
        root = graph['root_node_id']
        root_data = graph['nodes'][root]
        verify('root and two actual normalized hotspots persisted', len(root_data['hotspots']) == 2)
        asset, asset_headers = request('GET', root_data['image_url'])
        verify('uploaded image served through nginx', asset.startswith(b'\x89PNG') and asset_headers.get('content-type') == 'image/png')
        verify('upload response security headers', asset_headers.get('x-content-type-options') == 'nosniff' and "default-src 'none'" in asset_headers.get('content-security-policy', ''))
        scene = {'version': 1, 'layout': 'sequence', 'sections': [
            {'id': 'overview-' + str(index), 'title': hotspot['label'], 'body': 'Postgres JSONB 内容', 'hotspot_id': hotspot['id']}
            for index, hotspot in enumerate(root_data['hotspots'])]}
        edited = json_request('PATCH', f'/api/projects/{project}/nodes/{root}', {'title': '已编辑页面', 'description': '保存后可读回', 'scene_document': scene})
        verify('editable scene JSONB HTTP roundtrip', edited['scene_document'] == scene)
        request('PATCH', f'/api/projects/{other_project}/nodes/{root}', {'title': 'must not change'}, expected=404)
        verify('node ownership enforced across projects', json_request('GET', f'/api/projects/{project}')['nodes'][root]['title'] == '已编辑页面')
        hotspots = root_data['hotspots']
        request('PATCH', f'/api/projects/{project}/nodes/{root}/hotspots', {'hotspots': [{'id': h['id'], 'selected': True} for h in hotspots]})
        first, _ = request('POST', f'/api/projects/{project}/nodes/{root}/generate-children', {}, ai=True)
        first_events = [json.loads(line[6:]) for line in first.decode().splitlines() if line.startswith('data: ')]
        done = next(event for event in first_events if event.get('done'))
        verify('partial generation retains successful child', len(done['nodes']) == 1 and len(done['failed_hotspot_ids']) == 1)
        graph = json_request('GET', f'/api/projects/{project}')
        verify('partial generation restores parent status', graph['nodes'][root]['status'] != 'generating' and len(graph['nodes']) == 2)
        second, _ = request('POST', f'/api/projects/{project}/nodes/{root}/generate-children', {}, ai=True)
        second_events = [json.loads(line[6:]) for line in second.decode().splitlines() if line.startswith('data: ')]
        done = next(event for event in second_events if event.get('done'))
        graph = json_request('GET', f'/api/projects/{project}')
        verify('retry creates only failed child and keeps first relation', len(done['nodes']) == 1 and len(graph['nodes']) == 3 and len(graph['nodes'][root]['children']) == 2)
        verify('only the failed child provider call was retried', counters == {'analysis': 1, 'child_success': 1, 'child_retry': 2, 'text_analysis': 0})
        child = graph['nodes'][root]['children'][0]
        request('POST', f'/api/projects/{project}/nodes/{child}/regeneration-jobs',
                {'operation_id': 'stack-regen-' + child, 'generate_images': False}, ai=True, expected=409)
        latest = json_request('GET', f'/api/projects/{project}')
        verify('structured page regeneration refuses destructive replacement', latest['nodes'][child] == graph['nodes'][child])
        verify('generated knowledge has explicit connections and provenance', bool(latest['nodes'][child]['scene_document']['sections']) and
               all(h['kind'] == 'section' and h['position'] is None for h in latest['nodes'][child]['hotspots']) and
               latest['nodes'][child]['content_metadata']['review_status'] == 'unreviewed')
        upload(other_project, buffer.getvalue())
        other_root = json_request('GET', f'/api/projects/{other_project}')['root_node_id']
        new_hotspot = json_request('POST', f'/api/projects/{other_project}/nodes/{other_root}/hotspots', {'label': '人工热点', 'pos_x': 0.2, 'pos_y': 0.2, 'width': 0.2, 'height': 0.2}, expected=201)
        request('PATCH', f'/api/projects/{project}/nodes/{root}/hotspots', {'hotspots': [{'id': hotspots[0]['id'], 'label': 'must roll back'}, {'id': new_hotspot['id'], 'label': 'wrong node'}]}, expected=404)
        verify('mixed-owner hotspot batch atomically rolls back in Postgres', json_request('GET', f'/api/projects/{project}')['nodes'][root]['hotspots'][0]['label'] == hotspots[0]['label'])
        exported = json_request('GET', f'/api/projects/{project}/export.json')
        verify('export retains scene content and all nodes', len(exported['nodes']) == 3 and next(node for node in exported['nodes'] if node['id'] == root)['scene_document'] == latest['nodes'][root]['scene_document'])
        zip_bytes, _ = request('GET', f'/api/projects/{project}/export.zip')
        verify('legacy ZIP export through nginx', zip_bytes.startswith(b'PK\x03\x04'))
        direct_project = create('Temporary direct upload analysis verification')
        direct = upload(direct_project, buffer.getvalue(), direct=True)
        verify('new multipart analysis entry through nginx', any(event.get('done') for event in direct) and len(json_request('GET', f'/api/projects/{direct_project}')['nodes']) == 1)
        text_project = create('Temporary direct text analysis verification')
        boundary = 'flipbook-text-verification-boundary'
        fields = {'operation_id': 'direct-text-' + text_project, 'text': '蒸发、凝结与降水', 'generate_images': 'false'}
        form = ''.join(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n' for key, value in fields.items()).encode() + f'--{boundary}--\r\n'.encode()
        text_job = json_request('POST', f'/api/projects/{text_project}/analysis-jobs', form,
                                content_type=f'multipart/form-data; boundary={boundary}', ai=True, expected=202)
        text_done = wait_job(text_job)
        verify('new text analysis entry saves content without image credentials', text_done['kind'] == 'analyze' and text_done['result']['title'] == '直接入口：文字分析' and not text_done['result']['image_url'])
    finally:
        try:
            for project in projects:
                request('DELETE', f'/api/projects/{project}')
        finally:
            provider.shutdown()
            provider.server_close()
    report = {'base_url': args.base_url, 'provider': 'controlled local HTTP fake; no paid model calls', 'checks': events, 'provider_calls': counters, 'temporary_projects_deleted': projects}
    if args.evidence:
        args.evidence.parent.mkdir(parents=True, exist_ok=True)
        args.evidence.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
