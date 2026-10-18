#!/usr/bin/env python3
"""Real HTTP/process/Postgres acceptance for knowledge content, no paid models.

Creates and cleans a separate random database. --demo keeps only this test API
and fake provider alive for visible browser QA; enter JSON {"action":"stop"}.
Temporary synthetic keys are printed only in demo mode, never saved to files.
"""
import argparse
import json
import sys
import tempfile
from collections import Counter
from pathlib import Path

from durable_acceptance.harness import Harness
from durable_acceptance.support import audit, sql


def knowledge_node(node, *, model=None, input_kind=None):
    scene = node['scene_document']
    assert scene['version'] == 1 and scene['layout'] in {'atlas', 'sequence'}
    assert 1 <= len(scene['sections']) <= 6
    hotspots = {hotspot['id']: hotspot for hotspot in node['hotspots']}
    for section in scene['sections']:
        assert len(section['body']) >= 20
        connection = hotspots[section['hotspot_id']]
        assert connection['kind'] == 'section'
        assert connection['position'] is None and connection['size'] is None and connection['score'] is None
        assert connection['target_node_id'] == section.get('target_node_id')
    meta = node['content_metadata']
    assert meta['version'] == 1 and meta['review_status'] == 'unreviewed'
    assert meta['references'] == []  # Fake provider's forged reference was discarded.
    assert 'forged-model' not in json.dumps(meta)
    if model:
        assert meta['provenance']['model'] == model
    if input_kind:
        assert meta['provenance']['input_kind'] == input_kind


class KnowledgeAcceptance(Harness):
    def text(self, case, *, image=False, project=None):
        return self.submit_analysis(case, project=project, image=image)

    def select_first(self, project, node):
        self.server.request('PATCH', f'/projects/{project}/nodes/{node["id"]}/hotspots', json={
            'hotspots': [{'id': h['id'], 'selected': i == 0} for i, h in enumerate(node['hotspots'])]})

    def children(self, case, project, node, *, image=False):
        return self.server.json('POST', f'/projects/{project}/nodes/{node}/generation-jobs', expected=202,
                                headers=self.provider.headers(case),
                                json={'operation_id': case, 'selected_keywords': [], 'generate_images': image})

    def verify(self):
        case = 'knowledge_root_checkpoint'
        gate = self.gate(case, 'jobs.page_workflows.page_compose')
        self.boot([gate])
        project, job = self.text(case)
        jid = job['job_id']
        self.wait_gate(gate)
        assert self.provider.count(case, 'analysis') == 1
        self.server.kill()
        self.boot()
        self.server.wait(jid, 'succeeded')
        graph = self.graph(project)
        root = graph['nodes'][graph['root_node_id']]
        knowledge_node(root, model=case, input_kind='text')
        assert self.provider.count(case, 'analysis') == 1
        assert self.provider.count(case, 'image') == self.provider.count(case, 'localize') == 0
        assert self.text(case, project=project)[1]['job_id'] == jid
        self.record('root_knowledge_SIGKILL_after_analysis', same_operation_reused=True, analysis_calls=1, source_and_scene_saved=True)

        case = 'knowledge_child_image_checkpoint'
        self.select_first(project, root)
        gate = self.gate(case, 'jobs.workflows.provider_step', match={'stage': 'image', 'child_index': 0})
        self.boot([gate])
        job = self.children(case, project, root['id'], image=True)
        self.wait_gate(gate)
        assert self.provider.count(case, 'plan') == 1 and self.provider.count(case, 'image') == 0
        self.server.kill()
        self.boot()
        pending = self.server.wait(job['job_id'], 'waiting_credentials')
        assert pending['phase'] == 'image'
        self.credentials(case, job['job_id'])
        done = self.server.wait(job['job_id'], 'succeeded')
        child = done['result']['nodes'][0]
        knowledge_node(child, model=case, input_kind='parent_page')
        assert child['image_url'] and self.provider.count(case, 'plan') == self.provider.count(case, 'image') == 1
        assert self.provider.count(case, 'localize') == 0
        assert self.children(case, project, root['id'], image=True)['job_id'] == job['job_id']
        self.server.request('POST', f'/projects/{project}/nodes/{root["id"]}/generation-jobs', expected=409,
                            headers=self.provider.headers(case), json={'operation_id': case, 'generate_images': False})
        graph = self.graph(project)
        updated_root = graph['nodes'][root['id']]
        assert updated_root['scene_document']['sections'][0]['target_node_id'] == child['id']
        assert child['id'] in updated_root['children']
        self.record('child_knowledge_SIGKILL_after_plan', plan_calls=1, image_calls=1, localize_calls=0, parent_references_atomic=True)

        case = 'knowledge_grandchild_text_only'
        self.select_first(project, child)
        done = self.server.wait(self.children(case, project, child['id'])['job_id'], 'succeeded')
        grandchild = done['result']['nodes'][0]
        knowledge_node(grandchild, model=case, input_kind='parent_page')
        assert not grandchild['image_url'] and self.provider.count(case, 'image') == 0
        self.record('second_level_knowledge_without_image_despite_image_key', pages=len(self.graph(project)['nodes']), image_calls=0)

        case = 'knowledge_root_unknown_image'
        self.provider.failures[(case, 'image')] = 'disconnect'
        partial_project, job = self.text(case, image=True)
        pending = self.server.wait(job['job_id'], 'waiting_confirmation')
        assert pending['confirmation']['can_accept'] and pending['phase'] == 'image'
        self.server.request('POST', f'/jobs/{job["job_id"]}/accept', json={'confirmation_id': pending['confirmation']['id']})
        done = self.server.wait(job['job_id'], 'partial')
        node = self.graph(partial_project)['nodes'][done['node_id']]
        knowledge_node(node, model=case, input_kind='text')
        assert not node['image_url'] and self.provider.count(case, 'image') == 1
        self.record('unknown_image_accept_retains_knowledge', additional_remote_calls=0, warnings_visible=True)

        case = 'knowledge_invalid_response'
        invalid_project, job = self.text(case, image=True)
        done = self.server.wait(job['job_id'], 'failed')
        assert done['error']['code'].startswith('invalid_knowledge')
        assert not done['confirmation'] and not self.graph(invalid_project)['root_node_id']
        assert self.provider.count(case, 'analysis') == 1 and self.provider.count(case, 'image') == 0
        self.record('invalid_knowledge_response_known_failure', automatic_retries=0, fabricated_content=False)

        case = 'knowledge_legacy_regeneration'
        legacy_project = self.server.json('POST', '/projects', json={'name': 'Legacy empty page'})['project_id']
        legacy_node = 'knowledge_legacy_fixture'
        references = [{'id': 'author-book', 'title': '作者参考书（验收示例）', 'note': '作者输入，系统未核实。'}]
        sql(self.database.url, "INSERT INTO nodes(id,project_id,title,description,content_metadata) VALUES($1,$2,'旧版空白页','已有页面上下文',$3::jsonb)",
            legacy_node, legacy_project, json.dumps({'version': 1, 'references': references, 'review_status': 'reviewed'}))
        sql(self.database.url, 'UPDATE projects SET root_node_id=$1 WHERE id=$2', legacy_node, legacy_project)
        job = self.submit_regeneration(case, legacy_project, legacy_node, image=False)
        self.server.wait(job['job_id'], 'succeeded')
        regenerated = self.graph(legacy_project)['nodes'][legacy_node]
        assert regenerated['content_metadata']['references'] == references
        assert regenerated['content_metadata']['review_status'] == 'unreviewed'
        assert regenerated['content_metadata']['provenance']['input_kind'] == 'page'
        assert regenerated['scene_document']['sections']
        self.record('legacy_page_regeneration_keeps_author_references', same_node_id=True, review_reset=True)

        case = 'knowledge_upload_image_mode'
        uploaded, job = self.submit_analysis(case, uploaded=True, image=False)
        done = self.server.wait(job['job_id'], 'succeeded')
        node = self.graph(uploaded)['nodes'][done['node_id']]
        assert not node.get('scene_document') and node['image_url'] and node['hotspots']
        assert all(h['kind'] == 'image' and h['position'] for h in node['hotspots'])
        assert node['content_metadata']['provenance']['input_kind'] == 'image'
        self.record('uploaded_image_retains_real_hotspots_and_provenance', image_mode=True, extra_localize_calls=0)

    def demo(self):
        self.provider.delay = 1.0
        self.directory.mkdir(exist_ok=True, parents=True)
        upload = self.directory / 'water-cycle-test.png'
        upload.write_bytes(self.provider.png)
        print(json.dumps({'api': self.server.base, 'provider_url': self.provider.base,
                          'model': 'knowledge_browser_demo', 'temporary_fake_key': self.provider.key,
                          'test_upload': str(upload), 'database': self.database.name,
                          'stdin_actions': 'calls / fail(stage,fault) / restart / delay(seconds) / stop'}, ensure_ascii=False), flush=True)
        for line in sys.stdin:
            command = json.loads(line)
            action = command.get('action')
            if action == 'stop':
                break
            if action == 'calls':
                print(json.dumps({'calls': self.provider.calls}), flush=True)
            elif action == 'fail':
                self.provider.failures[(command.get('case', 'knowledge_browser_demo'), command['stage'])] = command.get('fault', 400)
            elif action == 'delay':
                self.provider.delay = float(command.get('seconds', 1))
            elif action == 'restart':
                self.boot()
                print(json.dumps({'restarted': True}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database-url', required=True, help='Dedicated test admin connection; a new database is created')
    parser.add_argument('--evidence', required=True, type=Path)
    parser.add_argument('--demo', action='store_true')
    parser.add_argument('--port', type=int)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='flipbook-round5-') as temporary:
        harness = KnowledgeAcceptance(temporary, args.database_url, port=args.port)
        evidence = {'provider': 'local HTTP fake', 'paid_calls': 0, 'database': harness.database.name}
        try:
            harness.demo() if args.demo else harness.verify()
            evidence['scenarios'] = harness.scenarios
            evidence['provider_calls'] = dict(Counter(call['stage'] for call in harness.provider.calls))
            evidence['credential_audit'] = audit(harness.database.url, temporary, [harness.provider.key],
                                                 require_checkpoints=not args.demo)
        finally:
            harness.close()
        evidence['cleanup_complete'] = True
        args.evidence.parent.mkdir(parents=True, exist_ok=True)
        args.evidence.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'scenarios_passed': len(harness.scenarios), 'cleanup_complete': True}), flush=True)


if __name__ == '__main__':
    main()
