"""Shared real-app operations for process recovery and browser acceptance.

The harness owns a disposable database, a local HTTP provider and a Uvicorn
process. Scenario expectations live in the executable acceptance script.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

from .support import Database, Provider, Server, wait_until


class Harness:
    def __init__(self, directory, database_url, *, port=None):
        self.directory = Path(directory)
        self.database = Database(database_url)
        self.provider = Provider()
        self.server = None
        self.scenarios = []
        self.port = port
        self.boot()

    def boot(self, gates=None):
        if self.server:
            self.server.close()
        self.server = Server(self.directory / 'runtime', self.database.url, gates=gates, port=self.port)
        return self.server

    def gate(self, name, target, *, match=None, position='before'):
        path = self.directory / ('gate-' + name)
        return {'target': target, 'match': match or {}, 'position': position,
                'entered': str(path.with_suffix('.entered')), 'release': str(path.with_suffix('.release'))}

    def wait_gate(self, gate):
        wait_until(lambda: Path(gate['entered']).exists(), 'checkpoint gate ' + gate['target'])

    def graph(self, project):
        return self.server.json('GET', '/projects/' + project)

    def credentials(self, case, job_id, *, image=True):
        return self.server.json('POST', f'/jobs/{job_id}/credentials', headers=self.provider.headers(case, image=image))

    def record(self, scenario, **result):
        self.scenarios.append({'scenario': scenario, 'passed': True, **result})
        print('PASS ' + scenario, flush=True)

    def submit_analysis(self, case, *, project=None, uploaded=False, image=True, operation=None, data=None):
        project = project or self.server.json('POST', '/projects', json={'name': 'Acceptance / ' + case})['project_id']
        form = {'operation_id': operation or case, 'generate_images': 'true' if image else 'false'}
        if uploaded:
            form['file_sha256'] = hashlib.sha256(self.provider.png).hexdigest()
        else:
            form['text'] = case + ' 水循环：蒸发、凝结与降水'
        form.update(data or {})
        options = {'data': form, 'headers': self.provider.headers(case, image=image), 'expected': 202}
        if uploaded:
            options['files'] = {'file': ('pixels.png', self.provider.png, 'image/png')}
        job = self.server.json('POST', f'/projects/{project}/analysis-jobs', **options)
        assert job['kind'] == 'analyze' and job['target_node_id']
        return project, job

    def submit_regeneration(self, case, project, node, *, image=True, operation=None):
        job = self.server.json('POST', f'/projects/{project}/nodes/{node}/regeneration-jobs',
                               json={'operation_id': operation or case, 'generate_images': image},
                               headers=self.provider.headers(case, image=image), expected=202)
        assert job['kind'] == 'regenerate' and job['target_node_id'] == node
        return job

    def close(self):
        if self.server:
            self.server.close()
        self.provider.close()
        self.database.close()
