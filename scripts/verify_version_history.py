#!/usr/bin/env python3
"""Real API/Postgres acceptance for page history and branch-safe restoration.

Uses the production FastAPI/DBOS application and a local fake model provider.
Creates and deletes its own random database; never requires paid model keys.
"""
import argparse
import json
import tempfile
from pathlib import Path

from durable_acceptance.harness import Harness
from durable_acceptance.support import audit, sql


class HistoryAcceptance(Harness):
    def versions(self, project, node):
        return self.server.json('GET', f'/projects/{project}/nodes/{node}/versions')

    def patch(self, project, node, **changes):
        revision = self.graph(project)['revision']
        return self.server.json('PATCH', f'/projects/{project}/nodes/{node}',
                                json={**changes, 'expected_revision': revision})

    def restore(self, project, node, version, operation, revision=None, expected=200):
        if revision is None:
            revision = self.graph(project)['revision']
        body = {'operation_id': operation, 'expected_revision': revision}
        return self.server.json('POST', f'/projects/{project}/nodes/{node}/versions/{version}/restore',
                                json=body, expected=expected)

    def branch(self, case, project, node, hotspot):
        graph = self.graph(project)
        current = graph['nodes'][node]
        self.server.request('PATCH', f'/projects/{project}/nodes/{node}/hotspots', json={
            'expected_revision': graph['revision'],
            'hotspots': [{'id': h['id'], 'selected': h['id'] == hotspot} for h in current['hotspots']]})
        job = self.server.json('POST', f'/projects/{project}/nodes/{node}/generation-jobs', expected=202,
                               headers=self.provider.headers(case, image=False),
                               json={'operation_id': case, 'generate_images': False, 'selected_keywords': []})
        return self.server.wait(job['job_id'], 'succeeded')['result']['nodes'][0]

    def verify(self):
        project, job = self.submit_analysis('history_root', image=False)
        self.server.wait(job['job_id'], 'succeeded')
        graph = self.graph(project)
        root = graph['root_node_id']
        original = graph['nodes'][root]
        baseline = self.versions(project, root)['current_version_id']
        assert baseline and original['scene_document']['sections']
        self.record('generated_root_has_baseline', root_version=bool(baseline))

        reference = {'id': 'history-book', 'title': '作者验收参考书', 'note': '作者提供，系统未核验。'}
        self.patch(project, root, title='已校订的水循环', content_metadata={
            'version': 1, 'references': [reference], 'review_status': 'reviewed'})
        edited_version = self.versions(project, root)['current_version_id']
        assert edited_version != baseline
        assert self.graph(project)['nodes'][root]['content_metadata']['review_status'] == 'reviewed'
        before_count = len(self.versions(project, root)['versions'])
        self.patch(project, root, title='已校订的水循环')
        assert len(self.versions(project, root)['versions']) == before_count
        self.record('content_and_sources_versioned_without_noop_duplicates')

        first = self.branch('history_child_a', project, root, original['hotspots'][0]['id'])
        parent = self.graph(project)['nodes'][root]
        scene = parent['scene_document']
        self.patch(project, root, scene_document={**scene, 'sections': [*scene['sections'], {
            'id': 'later-idea', 'title': '后来增加的分支', 'body': '这一内容区块在早期版本之后添加，恢复早期页面仍然需要保留其真实子页连接。'}]})
        parent = self.graph(project)['nodes'][root]
        later = next(h for h in parent['hotspots'] if h['label'] == '后来增加的分支')
        second = self.branch('history_child_b', project, root, later['id'])
        grandchild = self.branch('history_grandchild', project, first['id'], first['hotspots'][0]['id'])
        graph = self.graph(project)
        assert len(graph['nodes']) == 4
        assert self.versions(project, first['id'])['current_version_id']
        self.record('branch_commits_record_parent_and_child_versions', pages=4)

        before_restore = self.versions(project, root)['current_version_id']
        before_children = set(graph['nodes'][root]['children'])
        detail = self.server.json('GET', f'/projects/{project}/nodes/{root}/versions/{baseline}')
        assert detail['preview']['title'] == original['title']
        assert len(detail['preview']['scene_document']['sections']) == 4
        assert any(h['target_node_id'] == second['id'] for h in detail['preview']['hotspots'])
        assert detail['preserved_branch_count'] >= 1
        assert self.graph(project)['nodes'][root]['title'] == '已校订的水循环'
        self.record('historical_preview_is_read_only_and_keeps_newer_connected_sections')

        expected_revision = self.graph(project)['revision']
        restored = self.restore(project, root, baseline, 'restore-baseline', expected_revision)
        current = self.graph(project)
        page = current['nodes'][root]
        assert page['title'] == original['title'] and set(page['children']) == before_children
        assert current['nodes'][first['id']]['children'] == [grandchild['id']]
        assert all(any(h['target_node_id'] == child for h in page['hotspots']) for child in before_children)
        assert page['content_metadata']['review_status'] == 'unreviewed'
        assert not page['content_metadata']['references']
        assert self.versions(project, root)['current_version_id'] not in {baseline, before_restore}
        self.record('restoration_adds_version_and_preserves_two_level_branch_graph')

        count = len(self.versions(project, root)['versions'])
        replay = self.restore(project, root, baseline, 'restore-baseline', expected_revision)
        assert replay == restored
        assert len(self.versions(project, root)['versions']) == count
        self.restore(project, root, edited_version, 'restore-baseline', expected_revision, expected=409)
        self.restore(project, root, edited_version, 'stale-restore', expected_revision, expected=409)
        self.server.request('PATCH', f'/projects/{project}/nodes/{root}', expected=409,
                            json={'title': '陈旧标签页不能覆盖', 'expected_revision': expected_revision})
        assert self.graph(project)['nodes'][root]['title'] == original['title']
        self.record('restore_operation_replay_and_stale_edit_conflict_are_safe')

        self.restore(project, root, edited_version, 'restore-reviewed-content')
        page = self.graph(project)['nodes'][root]
        assert page['title'] == '已校订的水循环'
        assert page['content_metadata']['references'] == [reference]
        assert page['content_metadata']['review_status'] == 'unreviewed'
        assert set(page['children']) == before_children
        self.record('restore_can_recover_pre_undo_content_but_requires_new_author_review')

        self.boot()
        page = self.graph(project)['nodes'][root]
        assert page['title'] == '已校订的水循环'
        assert self.versions(project, root)['current_version_id']
        self.record('versions_and_restoration_survive_process_restart')

        self.server.request('GET', f'/projects/{project}/nodes/{first["id"]}/versions/{baseline}', expected=404)
        self.restore(project, first['id'], baseline, 'wrong-page', expected=404)
        foreign = self.server.json('POST', '/projects', json={'name': 'Other workspace'})['project_id']
        self.server.request('GET', f'/projects/{foreign}/nodes/{root}/versions', expected=404)
        self.server.request('GET', f'/projects/{foreign}/nodes/{root}/versions/{baseline}', expected=404)
        self.restore(foreign, root, baseline, 'wrong-project', expected=404)
        polluted = sql(self.database.url, 'SELECT COUNT(*) AS n FROM node_versions v JOIN nodes n ON n.id=v.node_id WHERE v.project_id<>n.project_id')
        assert polluted[0]['n'] == 0
        self.record('cross_project_version_reads_and_restore_cannot_leak_or_pollute_history')
        export = self.server.json('GET', f'/projects/{project}/export.json')
        encoded = json.dumps(export, ensure_ascii=False)
        assert 'node_versions' not in encoded and 'expected_revision' not in encoded
        assert 'restore-baseline' not in encoded and self.provider.key not in encoded
        snapshots = sql(self.database.url, 'SELECT snapshot FROM node_versions')
        for row in snapshots:
            data = row['snapshot']
            if isinstance(data, str):
                data = json.loads(data)
            assert not {'children', 'parent_id', 'depth', 'status', 'provider_config', 'input', 'api_key'} & set(data)
            assert self.provider.key not in json.dumps(data)
        self.record('versions_are_page_scoped_private_and_excluded_from_publication')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database-url', required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='flipbook-history-') as directory:
        harness = HistoryAcceptance(directory, args.database_url)
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
