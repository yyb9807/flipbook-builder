#!/usr/bin/env python3
"""Real-process/Postgres acceptance for author-saved sources and section citations.

Run from the repository root with an explicit test administrator DSN. The script
creates and drops its own random database and starts isolated API/provider/reader
processes. Only an in-process local HTTP fake generates the original fixtures;
there are no public retrieval requests, real model calls, or .env/key reads.
Build the trusted reader first: npm --prefix frontend run build:publication.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import tempfile
import zipfile
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

import httpx

from durable_acceptance.support import Database, Provider, Server, audit
from verify_publications import PublicationAcceptance, Reader

ROOT = Path(__file__).resolve().parents[1]


def source_copy(identity, *, excerpt=None):
    """Original acceptance material, not a simulated third-party retrieval."""
    return {
        'id': identity, 'title': 'Original controlled water-cycle material / ' + identity,
        'url': 'https://example.org/flipbook-acceptance/' + identity,
        'excerpt': excerpt or 'This original controlled example describes water moving between reservoirs. '
                              'Energy transfer and temperature change connect evaporation and condensation.',
        'note': 'Original acceptance fixture; no external source was fetched or fact-checked.',
        'locator': 'Controlled introductory paragraph', 'source_revision': 'controlled-copy-1',
        'retrieved_at': '2026-10-19T03:04:05Z',
    }


def digest(reference):
    public = {key: value for key, value in reference.items() if key not in ('id', 'snapshot_sha256') and value is not None}
    return hashlib.sha256(json.dumps(public, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def metadata(node, references, *, reviewed=False):
    return {**(node.get('content_metadata') or {'version': 1}), 'references': references,
            'review_status': 'reviewed' if reviewed else 'unreviewed'}


class SourceCitationAcceptance(PublicationAcceptance):
    def __init__(self, directory, database_url, runtime):
        # Own each resource before startup so a failed boot still drops this DB.
        self.directory, self.runtime = Path(directory), Path(runtime).resolve()
        self.publications = self.directory / 'publications'
        self.database = self.provider = self.reader = self.server = None
        self.scenarios = []
        assert all((self.runtime / name).is_file() for name in ('player.js', 'player.css')), (
            'Build trusted reader first: npm --prefix frontend run build:publication')
        try:
            self.database = Database(database_url)
            self.provider = Provider()
            self.fake_key = self.provider.key
            self.reader = Reader.__new__(Reader)
            Reader.__init__(self.reader, self.directory, self.publications)
            self.boot()
        except BaseException:
            self.close()
            raise

    def boot(self, gates=None):
        if self.server:
            self.server.close()
        self.server = Server(self.directory / 'runtime', self.database.url, gates=gates, environment={
            'PUBLICATION_DIR': str(self.publications), 'PUBLICATION_RUNTIME_DIR': str(self.runtime),
            'PUBLICATION_BASE_URL': self.reader.base, 'PYTHON_DOTENV_DISABLED': '1',
            'LLM_API_KEY': '', 'IMG_GEN_API_KEY': '', 'KNOWLEDGE_GENERATION_REVISION': '',
        })
        return self.server

    def expect_rejected_edit(self, project, node, *, expected=400, **changes):
        before = self.graph(project)
        versions = self.versions(project, node)
        response = self.server.request('PATCH', f'/projects/{project}/nodes/{node}', expected=expected,
                                       json={'expected_revision': before['revision'], **changes})
        assert self.graph(project) == before
        assert self.versions(project, node) == versions
        return response

    def verify(self):
        # These validation failures must occur before the fixed-origin adapter.
        for endpoint, params in (
            ('search', {'q': 'water', 'language': 'fr'}),
            ('page', {'key': 'https://127.0.0.1/private', 'language': 'en'}),
        ):
            self.server.request('GET', '/sources/' + endpoint, params=params, expected=422)
        self.record('invalid_source_language_and_key_are_rejected_without_public_requests')

        project, job = self.submit_analysis('sources_controlled_root', image=False)
        self.server.wait(job['job_id'], 'succeeded')
        graph = self.graph(project)
        root = graph['root_node_id']
        child = self.branch('sources_controlled_child', project, root, graph['nodes'][root]['hotspots'][0]['id'])
        grandchild = self.branch('sources_controlled_grandchild', project, child['id'], child['hotspots'][0]['id'])
        assert len(self.graph(project)['nodes']) == 3
        self.record('local_fake_generates_a_real_three_level_knowledge_graph', pages=3, real_model_calls=0)

        page = self.graph(project)['nodes'][root]
        document = copy.deepcopy(page['scene_document'])
        document['sections'][0]['reference_ids'] = ['controlled_primary']
        original_reference = source_copy('controlled_primary')
        saved = self.patch(project, root, scene_document=document,
                           content_metadata=metadata(page, [original_reference], reviewed=True))
        expected_metadata = saved['content_metadata']
        primary = expected_metadata['references'][0]
        assert primary['snapshot_sha256'] == digest(primary)
        assert saved['scene_document']['sections'][0]['reference_ids'] == ['controlled_primary']
        assert expected_metadata['review_status'] == 'reviewed'
        self.record('source_copy_hash_and_section_association_save_atomically_with_explicit_author_review')

        rejected = self.expect_rejected_edit(project, root, title='Must never commit',
                                             content_metadata=metadata(saved, []))
        assert '解除' in rejected.json()['detail']
        self.expect_rejected_edit(project, root, scene_document={**document, 'sections': [
            {**document['sections'][0], 'reference_ids': ['foreign_page_source']}, *document['sections'][1:]]})
        self.record('referenced_source_delete_and_foreign_source_reject_without_content_revision_or_history_changes')

        unlinked = copy.deepcopy(saved['scene_document'])
        unlinked['sections'][0]['reference_ids'] = []
        removed = self.patch(project, root, scene_document=unlinked, content_metadata=metadata(saved, []))
        assert not removed['content_metadata']['references']
        assert removed['scene_document']['sections'][0]['reference_ids'] == []
        assert removed['content_metadata']['review_status'] == 'unreviewed'
        self.record('unlink_and_source_removal_commit_together')

        reviewed = self.patch(project, root, scene_document=document,
                              content_metadata=metadata(removed, [original_reference], reviewed=True))
        revised_scene = copy.deepcopy(reviewed['scene_document'])
        revised_scene['sections'][0]['body'] += ' This sentence is an original controlled author correction.'
        revised = self.patch(project, root, scene_document=revised_scene)
        assert revised['content_metadata']['review_status'] == 'unreviewed'
        declared = self.patch(project, root, title='Controlled cited edition',
                              content_metadata=metadata(revised, revised['content_metadata']['references'], reviewed=True))
        assert declared['content_metadata']['review_status'] == 'reviewed'
        changed_reference = {**declared['content_metadata']['references'][0],
                             'excerpt': 'A revised original controlled source copy; energy transfer affects phase change.'}
        changed = self.patch(project, root, content_metadata=metadata(declared, [changed_reference]))
        assert changed['content_metadata']['review_status'] == 'unreviewed'
        assert changed['content_metadata']['references'][0]['snapshot_sha256'] == digest(changed['content_metadata']['references'][0])
        assert changed['content_metadata']['references'][0]['snapshot_sha256'] != primary['snapshot_sha256']
        self.record('body_and_source_changes_reset_old_review_but_same_batch_author_declaration_is_respected')

        baseline = self.versions(project, root)['current_version_id']
        current = self.graph(project)['nodes'][root]
        new_reference = source_copy('controlled_later', excerpt='An original later example links cooling water vapor to condensation. '
                                    'It is retained with a newly connected branch when an older page version is restored.')
        later_scene = copy.deepcopy(current['scene_document'])
        later_scene['sections'].append({'id': 'later-cited-idea', 'title': 'Later cited branch',
                                        'body': 'This original later section has both a real child page and its own saved source copy.',
                                        'reference_ids': ['controlled_later']})
        self.patch(project, root, scene_document=later_scene,
                   content_metadata=metadata(current, [*current['content_metadata']['references'], new_reference]))
        parent = self.graph(project)['nodes'][root]
        later_hotspot = next(item for item in parent['hotspots'] if item['label'] == 'Later cited branch')
        later_child = self.branch('sources_controlled_later', project, root, later_hotspot['id'])
        before = self.graph(project)
        preview = self.server.json('GET', f'/projects/{project}/nodes/{root}/versions/{baseline}')
        assert self.graph(project) == before and preview['preserved_branch_count'] == 1
        assert {reference['id'] for reference in preview['preview']['content_metadata']['references']} == {'controlled_primary', 'controlled_later'}
        restored = self.restore(project, root, baseline, 'restore-cited-baseline')
        assert restored['preserved_branch_count'] == 1
        root_page = self.graph(project)['nodes'][root]
        retained = next(section for section in root_page['scene_document']['sections'] if section['id'] == 'later-cited-idea')
        assert retained['target_node_id'] == later_child['id'] and retained['reference_ids'] == ['controlled_later']
        assert self.graph(project)['nodes'][child['id']]['children'] == [grandchild['id']]
        assert len(self.graph(project)['nodes']) == 4
        assert root_page['content_metadata']['review_status'] == 'unreviewed'
        self.record('history_preview_and_restore_preserve_newer_connected_section_its_source_and_three_level_graph')

        # The old version includes primary v1. Give a newly retained section a
        # different primary copy under that same ID: restoration must conflict.
        conflict_baseline = self.versions(project, root)['current_version_id']
        conflict_scene = copy.deepcopy(root_page['scene_document'])
        conflict_scene['sections'].append({'id': 'conflicting-later-citation', 'title': 'Later conflicting citation',
                                           'body': 'A later connected section explicitly cites a changed copy under an existing source identifier.',
                                           'reference_ids': ['controlled_primary']})
        conflict_copy = {**root_page['content_metadata']['references'][0],
                         'excerpt': 'An incompatible controlled source copy under the same identifier.'}
        remaining = [reference for reference in root_page['content_metadata']['references'] if reference['id'] != conflict_copy['id']]
        self.patch(project, root, scene_document=conflict_scene,
                   content_metadata=metadata(root_page, [conflict_copy, *remaining]))
        parent = self.graph(project)['nodes'][root]
        conflicting_hotspot = next(item for item in parent['hotspots'] if item['label'] == 'Later conflicting citation')
        self.branch('sources_controlled_conflict', project, root, conflicting_hotspot['id'])
        before = self.graph(project)
        before_versions = self.versions(project, root)
        self.server.request('GET', f'/projects/{project}/nodes/{root}/versions/{conflict_baseline}', expected=409)
        result = self.restore(project, root, conflict_baseline, 'reject-source-copy-conflict', expected=409)
        assert '来源版本冲突' in result['detail']
        assert self.graph(project) == before and self.versions(project, root) == before_versions
        self.record('same_id_different_source_copy_conflicts_in_preview_and_restore_without_any_write')

        current_graph = self.graph(project)
        current_page = current_graph['nodes'][root]
        expected_scene, expected_metadata = current_page['scene_document'], current_page['content_metadata']
        for reference in expected_metadata['references']:
            assert reference['snapshot_sha256'] == digest(reference)
        exported = self.server.json('GET', f'/projects/{project}/export.json')
        assert self.fake_key not in json.dumps(exported, ensure_ascii=False)
        exported_page = next(node for node in exported['nodes'] if node['id'] == root)
        assert exported_page['scene_document'] == expected_scene and exported_page['content_metadata'] == expected_metadata
        zipped = self.server.request('GET', f'/projects/{project}/export.zip')
        with zipfile.ZipFile(io.BytesIO(zipped.content)) as archive:
            assert self.fake_key.encode() not in b''.join(archive.read(name) for name in archive.namelist())
            html = archive.read('index.html').decode()
        payload = json.loads(html.split('const DATA = ', 1)[1].split(';\n', 1)[0])
        zipped_page = next(node for node in payload['nodes'] if node['id'] == root)
        assert zipped_page['scene_document'] == expected_scene and zipped_page['content_metadata'] == expected_metadata
        assert 'excerpt.textContent' in html and 'readerJumpLink' in html
        self.record('json_and_backend_zip_keep_source_excerpts_hashes_and_section_citations', pages=len(current_graph['nodes']))

        publication = self.publish(project, 'publish-cited-edition')
        resources = self.public_bytes(publication)
        public_graph = json.loads(resources['project.json'])
        public_page = public_graph['nodes'][root]
        assert public_page['scene_document'] == expected_scene and public_page['content_metadata'] == expected_metadata
        assert len(public_graph['nodes']) == 5
        assert resources['player.js'] == (self.runtime / 'player.js').read_bytes()
        assert resources['player.css'] == (self.runtime / 'player.css').read_bytes()
        assert self.fake_key.encode() not in b''.join(resources.values())
        self.record('fixed_publication_keeps_cited_content_and_trusted_reader_bytes', pages=5,
                    project_sha256=hashlib.sha256(resources['project.json']).hexdigest())

        self.patch(project, root, title='Changed after fixed publication')
        assert self.graph(project)['nodes'][root]['title'] != public_page['title']
        assert self.public_bytes(publication) == resources
        self.record('later_original_edits_do_not_change_any_published_byte')

        self.provider_call_counts = dict(Counter(call['stage'] for call in self.provider.calls))
        assert sum(self.provider_call_counts.values()) == 5
        self.server.close()
        self.server = None
        self.provider.close()
        self.provider = None
        assert self.public_bytes(publication) == resources
        assert httpx.get(publication['url']).status_code == 200
        assert json.loads(httpx.get(publication['url'] + 'project.json').content)['nodes'][root]['content_metadata'] == expected_metadata
        for path in ('/api/sources/search?q=water', '/api/sources/page?key=Water_cycle'):
            assert httpx.get(self.reader.base + path).status_code == 404
        self.record('independent_reader_serves_saved_citations_with_editor_and_provider_stopped')
        self.credential_audit = audit(self.database.url, self.directory, [self.fake_key])
        self.record('isolated_database_checkpoints_and_logs_contain_no_provider_key')

    def close(self):
        # Stop only resources created by this invocation, including partial boots.
        errors = []
        for name in ('server', 'provider', 'reader', 'database'):
            resource = getattr(self, name, None)
            if resource is not None:
                try:
                    resource.close()
                except Exception as error:
                    errors.append(error)
                finally:
                    setattr(self, name, None)
        if errors:
            raise RuntimeError('Source acceptance resource cleanup failed') from errors[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database-url', required=True, help='Test admin DSN; a fresh random database is created')
    parser.add_argument('--runtime', type=Path, default=ROOT / 'backend/publication_runtime')
    parser.add_argument('--evidence', required=True, type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='flipbook-source-citations-', dir='/tmp') as directory:
        harness = SourceCitationAcceptance(directory, args.database_url, args.runtime)
        try:
            harness.verify()
            evidence = {
                'checked_at': datetime.now(UTC).isoformat(), 'provider': 'local HTTP fake',
                'real_model_calls': 0, 'paid_calls': 0, 'public_source_requests': 0,
                'source_material': 'original controlled author-saved excerpts; no factual verification',
                'dotenv_loading_disabled': True, 'scenarios': harness.scenarios,
                'provider_calls': harness.provider_call_counts, 'credential_audit': harness.credential_audit,
            }
        finally:
            harness.close()
        evidence['isolated_database_cleaned'] = True
        args.evidence.parent.mkdir(parents=True, exist_ok=True)
        args.evidence.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'passed': len(harness.scenarios), 'isolated_database_cleaned': True}), flush=True)


if __name__ == '__main__':
    main()
