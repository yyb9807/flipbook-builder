from html.parser import HTMLParser

from scripts.quality_eval.dataset import load_suite
from scripts.quality_eval.report import write_report
from scripts.quality_eval.scoring import compare_runs
from scripts.quality_eval.tests.test_scoring import fixture_run, reviewed, seal


class Elements(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))


def test_report_is_offline_script_free_escaped_and_copies_ground_truth(tmp_path):
    suite = load_suite()
    run = fixture_run(suite)
    first = run["cases"][0]["project"]
    first["nodes"][first["root_node_id"]]["title"] = '</h3><script>alert("x")</script>'
    seal(run)
    result = write_report(run, suite, tmp_path)
    page = (tmp_path / "report.html").read_text()
    parser = Elements()
    parser.feed(page)
    assert result["human_quality"] == "not_reviewed"
    assert not any(tag == "script" for tag, _ in parser.tags)
    assert not any(key.startswith("on") for _, attrs in parser.tags for key in attrs)
    assert '&lt;script&gt;' in page
    assert "default-src 'none'" in page
    assert 'grid-template-columns:1fr' in page
    images = [attrs["src"] for tag, attrs in parser.tags if tag == "img"]
    assert len(images) == 2
    assert all(image.startswith("assets/") and (tmp_path / image).is_file() for image in images)
    assert "受控回放 / Controlled replay" in page
    assert (tmp_path / "assessment.json").is_file()
    assert (tmp_path / "review-template.json").is_file()


def test_report_embeds_comparable_pair_content_without_external_runs(tmp_path):
    suite = load_suite()
    run = fixture_run(suite)
    comparison = compare_runs(run, run, suite)
    write_report(run, suite, tmp_path, comparison=comparison)
    page = (tmp_path / "report.html").read_text()
    assert "正文与诊断对照" in page
    assert "基线 / Baseline" in page and "候选 / Candidate" in page
    assert 'class="pages paired"' in page
    assert '生成结果可比 / Generation comparable：<strong>true</strong>' in page
    assert '评审分数可比 / Review scores comparable：<strong>false</strong>' in page
    assert "评审分数不可直接比较" in page
    assert "base_review_missing_invalid_or_partial" in page


def test_explicit_malformed_review_is_shown_as_invalid_without_crash(tmp_path):
    suite = load_suite()
    run = fixture_run(suite)
    result = write_report(run, suite, tmp_path, review={"cases": None, "reviewer": None})
    assert result["human_quality"] == "not_approved"
    assert "review_case_coverage_mismatch" in (tmp_path / "report.html").read_text()


def test_report_preserves_in_progress_review_template_even_after_run_change(tmp_path):
    suite = load_suite()
    run = fixture_run(suite)
    write_report(run, suite, tmp_path)
    template_path = tmp_path / "review-template.json"
    in_progress = 'Work in progress: never erase the author\'s review.'
    template_path.write_text(in_progress)
    run["model"] = "changed-model"
    seal(run)
    write_report(run, suite, tmp_path)
    assert template_path.read_text() == in_progress


def test_report_uses_recorded_parent_context_and_preserves_legacy_fallback(tmp_path):
    suite = load_suite()
    run = fixture_run(suite)
    output = run["cases"][0]
    root, child = [output["project"]["nodes"][node_id] for node_id in output["branch_node_ids"][:2]]
    recorded = 'Frozen actual context with source boundaries <recorded> & additional coverage.'
    output["branch_path"][0].update(parent_context=recorded, parent_context_kind="enriched-context-v2")
    seal(run)
    write_report(run, suite, tmp_path)
    contexts = (tmp_path / "report.html").read_text().split('<details class="context">')
    actual = contexts[1].split('</details>', 1)[0]
    legacy = contexts[2].split('</details>', 1)[0]
    assert 'Frozen actual context with source boundaries &lt;recorded&gt; &amp; additional coverage.' in actual
    assert root["scene_document"]["sections"][0]["body"] not in actual
    assert '类型：<code>enriched-context-v2</code>' in actual
    assert child["scene_document"]["sections"][0]["body"] in legacy
    assert '类型：<code>legacy-reconstructed</code>' in legacy
    assert '本次实际发送的父页上下文；输入范围以记录为准' in actual
    assert '未额外注入祖先全文' not in actual


def test_stale_review_scores_are_not_rendered_as_valid(tmp_path):
    suite = load_suite()
    run = fixture_run(suite)
    review = reviewed(run, suite)
    review["run_sha256"] = "stale"
    review["cases"][0]["dimensions"]["body"]["reason"] = "STALE-REVIEW-SHOULD-NOT-SHOW"
    write_report(run, suite, tmp_path, review)
    page = (tmp_path / "report.html").read_text()
    assert "原始评分未生效" in page
    assert "STALE-REVIEW-SHOULD-NOT-SHOW" not in page


def test_agent_report_labels_review_and_renders_escaped_page_evidence(tmp_path):
    suite = load_suite()
    run = fixture_run(suite)
    first_output = run["cases"][0]
    first_root = first_output["project"]["nodes"][first_output["project"]["root_node_id"]]
    malicious_quote = 'Actual page evidence </blockquote><script>alert("quote")</script>'
    first_root["scene_document"]["sections"][0]["body"] += malicious_quote
    seal(run)
    review = reviewed(run, suite)
    review["reviewer"] = {"kind": "agent", "name": "Report test agent", "model": "controlled-test", "version": "1"}
    for entry, output in zip(review["cases"], run["cases"]):
        nodes = output["project"]["nodes"]
        root_id = output["project"]["root_node_id"]
        root = nodes[root_id]
        entry["inspected_node_ids"] = list(nodes)
        evidence = [{"node_id": root_id, "quote": root["title"]}]
        for item in [*entry["dimensions"].values(), *entry["fact_checks"], *entry["forbidden_claims"]]:
            item["evidence"] = evidence
        if root.get("scene_document"):
            section = root["scene_document"]["sections"][0]
            entry["dimensions"]["body"]["evidence"] = [
                {"node_id": root_id, "section_id": section["id"], "quote": section["body"]}]
    result = write_report(run, suite, tmp_path, review)
    page = (tmp_path / "report.html").read_text()
    parser = Elements()
    parser.feed(page)
    assert result["human_quality"] == "not_reviewed"
    assert all(item["review"]["status"] == "passed" for item in result["cases"])
    assert "自主评审质量 / Agent quality" in page
    assert "自主评审 / Agent review" in page
    assert "人工评审 / Manual review" not in page
    assert "已检查页面 / Inspected nodes" in page
    assert f'Node: <code>{first_root["id"]}</code> · Section: <code>section_1</code>' in page
    assert '&lt;script&gt;alert(&quot;quote&quot;)&lt;/script&gt;' in page
    assert not any(tag == "script" for tag, _ in parser.tags)
