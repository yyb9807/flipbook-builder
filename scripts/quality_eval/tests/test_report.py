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
