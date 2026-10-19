#!/usr/bin/env python3
"""Real HTTP/Postgres acceptance for frozen publications and the standalone reader.

Uses isolated temporary storage and a random disposable database. A local fake
model generates the branching fixtures; no paid credentials or services are used.
Run `cd frontend && npm run build:publication` once before this script.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urljoin

import httpx

from durable_acceptance.support import Server, audit, free_port, wait_until
from verify_version_history import HistoryAcceptance

ROOT = Path(__file__).resolve().parents[1]


class Reader:
    def __init__(self, directory: Path, publications: Path):
        self.base = f'http://127.0.0.1:{free_port()}'
        self.log = (directory / 'reader.log').open('ab')
        # Deliberately omit database and model configuration, including .env load.
        environment = {key: value for key, value in os.environ.items()
                       if not key.startswith(('DATABASE_', 'DBOS_', 'LLM_', 'IMG_GEN_'))}
        environment['PUBLICATION_DIR'] = str(publications)
        self.process = subprocess.Popen(
            [sys.executable, '-m', 'uvicorn', 'reader:app', '--host', '127.0.0.1',
             '--port', self.base.rsplit(':', 1)[1], '--no-access-log'],
            cwd=ROOT / 'backend', env=environment, stdout=self.log, stderr=self.log,
        )
        wait_until(self.healthy, 'independent reader startup')

    def healthy(self):
        if self.process.poll() is not None:
            raise AssertionError('Standalone reader exited; see reader.log')
        try:
            return httpx.get(self.base + '/healthz', timeout=0.5).status_code == 200
        except httpx.HTTPError:
            return False

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            self.process.wait(timeout=10)
        self.log.close()


class PublicationAcceptance(HistoryAcceptance):
    def __init__(self, directory, database_url, runtime):
        self.publications = Path(directory) / 'publications'
        self.runtime = Path(runtime).resolve()
        assert all((self.runtime / name).is_file() for name in ('player.js', 'player.css')), (
            'Build trusted runtime first: cd frontend && npm run build:publication')
        self.reader = Reader(Path(directory), self.publications)
        try:
            super().__init__(directory, database_url)
        except BaseException:
            self.reader.close()
            raise

    def boot(self, gates=None):
        if self.server:
            self.server.close()
        self.server = Server(self.directory / 'runtime', self.database.url, gates=gates,
                             environment={'PUBLICATION_DIR': str(self.publications),
                                          'PUBLICATION_RUNTIME_DIR': str(self.runtime),
                                          'PUBLICATION_BASE_URL': self.reader.base})
        return self.server

    def publish(self, project, operation, *, revision=None, expected=201):
        if revision is None:
            revision = self.graph(project)['revision']
        response = self.server.json('POST', f'/projects/{project}/publications', expected=expected,
                                    json={'operation_id': operation, 'expected_revision': revision})
        return response.get('publication')

    def public_bytes(self, publication):
        base = publication['url']
        resources = {name: httpx.get(urljoin(base, name)).content
                     for name in ('index.html', 'project.json', 'player.js', 'player.css')}
        graph = json.loads(resources['project.json'])
        for node in graph['nodes'].values():
            if node.get('image_url'):
                image = httpx.get(urljoin(base, node['image_url']))
                assert image.status_code == 200
                assert image.headers['content-type'] == 'image/png'
                resources[node['image_url']] = image.content
        for resource in resources:
            response = httpx.get(urljoin(base, resource))
            assert response.status_code == 200, (resource, response.status_code)
            assert response.headers['cache-control'] == 'no-store'
        return resources

    def verify(self):
        project, job = self.submit_analysis('publication_root', image=False)
        self.server.wait(job['job_id'], 'succeeded')
        graph = self.graph(project)
        root = graph['root_node_id']
        child = self.branch('publication_child', project, root, graph['nodes'][root]['hotspots'][0]['id'])
        self.branch('publication_grandchild', project, child['id'], child['hotspots'][0]['id'])
        self.patch(project, root, content_metadata={
            'version': 1, 'references': [{'id': 'author-ref', 'title': 'Author reference',
                                        'url': 'https://example.com/reference', 'note': 'Author supplied'}],
            'review_status': 'reviewed'})
        baseline = self.versions(project, root)['current_version_id']
        revision_a = self.graph(project)['revision']
        publication_a = self.publish(project, 'publish-a', revision=revision_a)
        bytes_a = self.public_bytes(publication_a)
        graph_a = json.loads(bytes_a['project.json'])
        assert publication_a['page_count'] == 3 and len(graph_a['nodes']) == 3
        assert graph_a['nodes'][root]['content_metadata']['references'][0]['id'] == 'author-ref'
        assert graph_a['nodes'][root]['content_metadata']['review_status'] == 'reviewed'
        assert graph_a['nodes'][child['id']]['children']
        assert not {'revision', 'generation_jobs', 'node_versions', 'provider_config', 'input'} & set(graph_a)
        for node in graph_a['nodes'].values():
            assert not {'input', 'provider_config', 'operation_id', 'versions'} & set(node)
        assert self.provider.key.encode() not in b''.join(bytes_a.values())
        self.record('three_level_snapshot_preserves_sources_and_excludes_private_state', pages=3)

        assert self.publish(project, 'publish-a', revision=revision_a, expected=200) == publication_a
        self.publish(project, 'publish-a', revision=revision_a + 1, expected=409)
        self.record('same_operation_is_idempotent_and_parameter_reuse_conflicts')

        self.patch(project, root, title='Edited after publication A')
        self.restore(project, root, baseline, 'restore-after-publication')
        self.patch(project, root, title='New edition B')
        graph = self.graph(project)
        other_hotspot = next(h for h in graph['nodes'][root]['hotspots'] if not h['target_node_id'])
        self.branch('publication_later_branch', project, root, other_hotspot['id'])
        self.publish(project, 'stale-publication', revision=revision_a, expected=409)
        assert self.public_bytes(publication_a) == bytes_a
        publication_b = self.publish(project, 'publish-b')
        graph_b = json.loads(self.public_bytes(publication_b)['project.json'])
        assert publication_b['id'] != publication_a['id'] and publication_b['source_revision'] > revision_a
        assert len(graph_b['nodes']) == 4 and graph_b['nodes'][root]['title'] == 'New edition B'
        assert graph_a['nodes'][root]['title'] != 'New edition B'
        self.record('editing_restoration_and_new_branch_never_change_old_bytes_new_publish_has_new_url')

        self.boot()
        assert self.public_bytes(publication_a) == bytes_a
        listed = self.server.json('GET', f'/projects/{project}/publications')['publications']
        assert {p['id'] for p in listed} == {publication_a['id'], publication_b['id']}
        self.record('publication_management_and_frozen_resources_survive_editor_restart')

        image_project, image_job = self.submit_analysis('publication_image', uploaded=True, image=False)
        self.server.wait(image_job['job_id'], 'succeeded')
        image_graph = self.graph(image_project)
        image_root = image_graph['root_node_id']
        image_publication = self.publish(image_project, 'publish-image')
        image_bytes = self.public_bytes(image_publication)
        public_image_url = json.loads(image_bytes['project.json'])['nodes'][image_root]['image_url']
        assert public_image_url.startswith('assets/') and image_bytes[public_image_url]
        source = self.directory / 'runtime' / 'assets' / image_graph['nodes'][image_root]['image_url'].lstrip('/')
        assert source.is_file()
        source.unlink()
        self.publish(image_project, 'missing-image', expected=409)
        assert self.public_bytes(image_publication) == image_bytes
        listed_images = self.server.json('GET', f'/projects/{image_project}/publications')['publications']
        assert len(listed_images) == 1
        assert not list(self.publications.glob('.staging-*'))
        self.record('image_bytes_are_independent_and_missing_source_rejects_without_partial_release')

        self.server.request('DELETE', f'/projects/{project}')
        self.server.request('DELETE', f'/projects/{image_project}')
        assert self.public_bytes(publication_a) == bytes_a
        assert self.public_bytes(image_publication) == image_bytes
        assert len(self.server.json('GET', f'/projects/{project}/publications')['publications']) == 2
        assert self.publish(project, 'publish-a', revision=revision_a, expected=200) == publication_a
        self.record('deleting_sources_keeps_published_pages_images_and_management_receipts')

        for path in ('/api/projects', '/api/test-config', '/uploads/test.png', '/docs', '/openapi.json', '/'):
            assert httpx.get(self.reader.base + path).status_code == 404, path
        for path in ('manifest.json', '../manifest.json', '%2e%2e/manifest.json', '.withdrawn/',
                     'assets/', 'assets/../../manifest.json', 'not-a-file.js'):
            assert httpx.get(urljoin(publication_a['url'], path), follow_redirects=True).status_code == 404, path
        for method in ('POST', 'PATCH', 'PUT', 'DELETE'):
            response = httpx.request(method, publication_a['url'], json={})
            assert response.status_code in (404, 405)
        head = httpx.head(publication_a['url'])
        assert head.status_code == 200 and head.content == b''
        assert head.headers['content-security-policy'].find("connect-src 'none'") >= 0
        assert head.headers['x-content-type-options'] == 'nosniff'
        self.record('reader_only_serves_allowlisted_get_head_without_editor_docs_private_files_or_traversal')

        withdrawn = self.server.json('DELETE', f'/projects/{project}/publications/{publication_a["id"]}')['publication']
        assert withdrawn['state'] == 'withdrawn'
        assert httpx.get(publication_a['url']).status_code == 404
        assert self.server.json('DELETE', f'/projects/{project}/publications/{publication_a["id"]}')['publication'] == withdrawn
        replay = self.publish(project, 'publish-a', revision=revision_a, expected=200)
        assert replay['state'] == 'withdrawn' and httpx.get(publication_a['url']).status_code == 404
        assert self.public_bytes(publication_b)
        self.record('withdrawal_is_idempotent_and_old_operation_cannot_resurrect_link')

        self.server.close()
        self.provider.close()
        assert self.public_bytes(publication_b)
        assert self.public_bytes(image_publication) == image_bytes
        self.record('reader_remains_functional_with_editor_and_provider_processes_stopped')

        # Byte equality covers HTML and the actual copied executable runtime too.
        for name in ('player.js', 'player.css'):
            assert bytes_a[name] == (self.runtime / name).read_bytes()
        self.record('trusted_reader_runtime_is_frozen_per_publication',
                    javascript_sha256=hashlib.sha256(bytes_a['player.js']).hexdigest())

    def close(self):
        self.reader.close()
        super().close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database-url', required=True)
    parser.add_argument('--runtime', type=Path, default=ROOT / 'backend/publication_runtime')
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='flipbook-publications-') as directory:
        harness = PublicationAcceptance(directory, args.database_url, args.runtime)
        try:
            harness.verify()
            evidence = {'provider': 'local HTTP fake', 'paid_calls': 0, 'scenarios': harness.scenarios,
                        'credential_audit': audit(harness.database.url, directory, [harness.provider.key])}
        finally:
            harness.close()
        evidence['isolated_database_cleaned'] = True
        args.evidence.parent.mkdir(parents=True, exist_ok=True)
        args.evidence.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'passed': len(harness.scenarios), 'isolated_database_cleaned': True}), flush=True)


if __name__ == '__main__':
    main()
