"""Portable, script-free review report with fixed evidence and image overlays."""
from __future__ import annotations

import hashlib
import html
import json
import shutil
from pathlib import Path

from .rubric import DIMENSIONS, review_template
from .scoring import _box, evaluate_run


def _escape(value):
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False, sort_keys=True)
    return html.escape(value, quote=True)


def _paragraph(value):
    return f"<p>{_escape(value)}</p>"


def _source(case):
    source = case.get("source", {})
    parts = ["<details><summary>固定依据与逐项核对 / Fixed source and review checks</summary>",
             "<h4>素材依据</h4>", _paragraph(source.get("text", "")), _paragraph(source.get("notes", ""))]
    parts.append("<ul>")
    for reference in source.get("references", []):
        parts.append(f"<li><strong>{_escape(reference.get('id', ''))}</strong> {_escape(reference.get('title', ''))}")
        url = reference.get("url", "")
        if isinstance(url, str) and url.startswith(("https://", "http://")):
            parts.append(f" <a href=\"{_escape(url)}\" rel=\"noreferrer noopener\">打开来源</a>")
        parts.append(f" {_escape(reference.get('checked_on', ''))}</li>")
    parts.append("</ul><table><thead><tr><th>ID</th><th>应核对事实</th><th>依据摘录</th></tr></thead><tbody>")
    for check in case.get("fact_checks", []):
        parts.append(f"<tr><td>{_escape(check['id'])}</td><td>{_escape(check['claim'])}</td>"
                     f"<td>{_escape(check.get('evidence_excerpt', ''))}</td></tr>")
    parts.append("</tbody></table><h4>禁止编造的结论</h4><ul>")
    for check in case.get("forbidden_claims", []):
        parts.append(f"<li>{_escape(check['id'])}：{_escape(check['claim'])} — {_escape(check.get('reason', ''))}</li>")
    parts.append("</ul><h4>已知边界</h4><ul>")
    parts.extend(f"<li>{_escape(item)}</li>" for item in case.get("unknown_limits", []))
    parts.append("</ul></details>")
    return "".join(parts)


def _image(case, node, suite, out):
    if case.get("input", {}).get("kind") != "image":
        return ""
    from .dataset import asset_path

    path = asset_path(suite, case)
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    name = digest + path.suffix.lower()
    assets = out / "assets"
    assets.mkdir(exist_ok=True)
    shutil.copyfile(path, assets / name)
    parts = ["<figure><div class=\"image-stage\">",
             f"<img src=\"assets/{_escape(name)}\" alt=\"{_escape(case['id'])} 固定测试图片\">"
             "<div class=\"overlays\" aria-hidden=\"true\">"]
    def draw(box, label, kind):
        x, y, width, height = box
        parts.append(f'<span class="box {kind}" style="left:{x * 100:.6f}%;top:{y * 100:.6f}%;'
                     f'width:{width * 100:.6f}%;height:{height * 100:.6f}%"><b>{_escape(label)}</b></span>')
    for index, truth in enumerate(case.get("expected_hotspots", [])):
        draw([truth["box"][key] for key in ("x", "y", "width", "height")], str(index + 1), "truth")
    for index, hotspot in enumerate(node.get("hotspots", [])):
        if hotspot.get("kind") != "section" and (rectangle := _box(hotspot)) is not None:
            draw(rectangle, str(index + 1), "actual")
    parts.append('</div></div><figcaption><span class="truth-key">虚线：固定标注框</span> · '
                 '<span class="actual-key">实线：模型热点框</span>。标签与定位指标见下表。</figcaption></figure>')
    return "".join(parts)


def _pages(case, output, suite, out):
    project = output.get("project") or {}
    nodes = project.get("nodes") or {}
    order = output.get("branch_node_ids", [])
    parts = ['<div class="pages">']
    for index, node_id in enumerate(order):
        node = nodes.get(node_id)
        if not isinstance(node, dict):
            continue
        parts.append(f'<article class="page"><div class="page-role">{["根页 / Root", "子页 / Child", "孙页 / Grandchild"][min(index, 2)]}</div>'
                     f'<h3>{_escape(node.get("title", ""))}</h3>{_paragraph(node.get("description", ""))}')
        if index == 0:
            parts.append(_image(case, node, suite, out))
        if index:
            steps = output.get("branch_path", [])
            step = steps[index - 1] if index <= len(steps) else {}
            parent = nodes.get(order[index - 1], {})
            selected = next((hotspot for hotspot in parent.get("hotspots", [])
                             if hotspot.get("target_node_id") == node_id), {})
            section = next((section for section in (parent.get("scene_document") or {}).get("sections", [])
                            if section.get("hotspot_id", section.get("id")) == selected.get("id")), {})
            context = section.get("body") or parent.get("description", "")
            parts.append('<details class="context"><summary>本页实际父上下文 / Actual parent context</summary>'
                         f'<p>入口：{_escape(step.get("label", selected.get("label", "")))}</p>{_paragraph(context)}'
                         '<p class="muted">仅所选区块正文（图片页使用描述），未额外注入祖先全文。</p></details>')
        document = node.get("scene_document") or {}
        for section in document.get("sections", []):
            parts.append(f'<section class="body-section"><h4>{_escape(section.get("title", ""))}</h4>'
                         f'{_paragraph(section.get("body", ""))}<code>{_escape(section.get("id", ""))}</code></section>')
        parts.append('<h4>热点与分支 / Hotspots</h4><ul class="hotspots">')
        for hotspot in node.get("hotspots", []):
            rectangle = _box(hotspot) if hotspot.get("kind") != "section" else None
            parts.append(f'<li>{_escape(hotspot.get("label", ""))} → '
                         f'<code>{_escape(hotspot.get("target_node_id") or "未展开 / unlinked")}</code>'
                         f'{_paragraph({"box": rectangle}) if rectangle else ""}</li>')
        parts.append('</ul></article>')
    parts.append('</div>')
    return "".join(parts)


def _review_rows(entry, case, *, invalid=False):
    if invalid:
        return '<p class="error">原始评分未生效 / Review invalid。摘要、方法、评审者或覆盖项不匹配；本报告不显示这些评分，请重新生成匹配本次运行的模板。</p>'
    if not entry:
        return '<p class="unreviewed">未审 / Not reviewed。自动检查通过不代表内容质量通过。</p>'
    parts = ['<table><thead><tr><th>人工维度 / Dimension</th><th>0–4</th><th>理由 / Reason</th><th>输出证据 / Evidence</th></tr></thead><tbody>']
    dimensions = entry.get("dimensions", {})
    if not isinstance(dimensions, dict):
        dimensions = {}
    for key, rubric in DIMENSIONS.items():
        value = dimensions.get(key, {})
        if not isinstance(value, dict):
            value = {}
        score = value.get("score")
        parts.append(f'<tr><td>{_escape(rubric["label"])}</td><td>{score if isinstance(score, int) and not isinstance(score, bool) else "未审"}</td>'
                     f'<td>{_escape(value.get("reason", ""))}</td><td>{_escape(value.get("evidence", ""))}</td></tr>')
    parts.append('</tbody></table>')
    for collection, title in (("fact_checks", "事实核对"), ("forbidden_claims", "禁止结论核对")):
        parts.append(f'<h4>{title}</h4><ul>')
        checks = {item["id"]: item for item in case.get(collection, [])}
        rows = entry.get(collection, [])
        if not isinstance(rows, list):
            rows = []
        for item in rows:
            if not isinstance(item, dict):
                continue
            parts.append(f'<li><strong>{_escape(checks.get(item.get("id"), {}).get("claim", item.get("id", "")))}</strong>：'
                         f'{_escape(item.get("verdict") or "未审")} — {_escape(item.get("reason", ""))}'
                         f'<blockquote>{_escape(item.get("evidence", ""))}</blockquote></li>')
        parts.append('</ul>')
    return ''.join(parts)


STYLE = """
:root{color-scheme:light;font:16px/1.6 system-ui,sans-serif;color:#243834;background:#f5f5ee}
*{box-sizing:border-box}body{margin:0}main{max-width:1440px;margin:auto;padding:36px 28px 80px}
h1,h2,h3,h4{line-height:1.25;color:#173f35}h1{font-size:clamp(1.8rem,4vw,3rem);margin:.5em 0}h2{font-size:1.5rem}
h3{font-size:1.25rem}h4{font-size:1rem;margin:1.3em 0 .5em}p{white-space:pre-wrap;overflow-wrap:anywhere}
a{color:#08634e}code{font-size:.8rem;overflow-wrap:anywhere}.muted,figcaption{color:#5f6c65;font-size:.86rem}
.banner{padding:18px 22px;border-left:5px solid #b37618;background:#fff4d8}.banner strong{font-size:1.2rem}
.summary{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}.summary span{padding:8px 12px;background:#e6ebe3;border-radius:4px}
nav{display:flex;gap:12px;flex-wrap:wrap}.case{padding-top:26px;margin-top:35px;border-top:2px solid #c6d1c7;scroll-margin-top:16px}
.pages{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:20px 0}.paired{grid-template-columns:repeat(2,minmax(0,1fr))}.page{min-width:0;background:#fff;padding:22px;border:1px solid #d5ded3}
.page-role{font-size:.75rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#4a6d5c}.body-section{border-top:1px solid #e2e7df;padding-top:1px}
details{border:1px solid #d4ded2;padding:12px 16px;margin:16px 0;background:#fafbf7}summary{cursor:pointer;font-weight:600}.context{font-size:.85rem}
table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:.88rem;overflow-wrap:anywhere}th,td{text-align:left;vertical-align:top;padding:9px;border:1px solid #d4ded2}th{background:#e6ede3}
ul{padding-left:22px}.findings li{margin:8px 0}.error{color:#8b2925}.warning,.unreviewed{color:#815518}.passed{color:#126442}
figure{margin:20px 0}.image-stage{position:relative;width:100%;isolation:isolate}.image-stage img{display:block;width:100%;height:auto}.overlays{position:absolute;inset:0}
.box{position:absolute;display:block;pointer-events:none}.box b{font-size:.7rem;background:white;position:absolute;top:0;left:0;line-height:1;padding:2px}
.truth{border:3px dashed #b45f00}.actual{border:2px solid #007466}.actual b{top:auto;bottom:0;left:auto;right:0}.truth-key{color:#9b5200}.actual-key{color:#007466}
blockquote{border-left:3px solid #bdccc0;margin:8px 0;padding-left:12px;white-space:pre-wrap;overflow-wrap:anywhere}footer{margin-top:40px;border-top:1px solid #c6d1c7;padding-top:20px}
@media(max-width:800px){main{padding:20px 14px 50px}.pages,.paired{grid-template-columns:1fr}.page{padding:18px}th,td{padding:6px;font-size:.8rem}table{table-layout:auto}.summary{display:grid;gap:7px}}
"""


def write_report(run, suite, out, review=None, comparison=None):
    """Write only allowlisted normalized content; raw responses remain private."""
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    assessment = evaluate_run(run, suite, review)
    (out / "assessment.json").write_text(json.dumps(assessment, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    template_path = out / "review-template.json"
    if not template_path.exists():
        template_path.write_text(json.dumps(review_template(run, suite), ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    parts = ['<!doctype html><html lang="zh"><head><meta charset="utf-8">',
             '<meta name="viewport" content="width=device-width,initial-scale=1">',
             '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'self\'; base-uri \'none\'; form-action \'none\'">',
             '<meta name="referrer" content="no-referrer"><title>固定样例质量评审 / Quality review</title>',
             f'<style>{STYLE}</style></head><body><main>',
             '<p class="muted">FLIPBOOK BUILDER · QUALITY REVIEW</p><h1>固定样例质量评审</h1>']
    if run.get("mode") == "replay":
        parts.append('<div class="banner"><strong>受控回放 / Controlled replay</strong><p>只校准评估流程，不是实际模型质量。人工模型质量保持未测，不产生总分或优胜模型。</p></div>')
    else:
        parts.append('<div class="banner"><strong>真实模型运行 / Live run</strong><p>自动诊断与人工判断分别展示。一次固定路径样本不构成统计优胜结论。</p></div>')
    parts.append('<div class="summary">')
    for label, key in (("执行 / Execution", "execution"), ("自动诊断 / Diagnostics", "automatic"),
                       ("人工质量 / Human quality", "human_quality"), ("夹具校准 / Calibration", "calibration")):
        parts.append(f'<span>{label}：<strong>{_escape(assessment[key])}</strong></span>')
    parts.append('</div>')
    for label, value in (("Model", run.get("model")),
                         ("Calls / reserved output tokens", [run.get("call_count"), run.get("reserved_output_tokens")])):
        parts.append(f'<p>{_escape(label)}：<strong>{_escape(value)}</strong></p>')
    parts.append('<details><summary>运行依据 / Run provenance</summary>')
    for label, value in (("Run", run.get("run_id")), ("Run SHA-256", assessment["run_sha256"]),
                         ("Suite SHA-256", run.get("suite_sha256")), ("Prompt/adapter sources SHA-256", run.get("prompt_sources_sha256")),
                         ("Producer SHA-256", run.get("producer_sha256")), ("Policy", run.get("policy")),
                         ("Recorded evaluator SHA-256", run.get("evaluator_sha256")),
                         ("Current evaluator SHA-256", assessment.get("evaluator_sha256")),
                         ("Reviewer", assessment.get("reviewer"))):
        parts.append(f'<p class="muted">{_escape(label)}：<code>{_escape(value)}</code></p>')
    parts.append('</details>')
    for error in assessment["binding_errors"] + assessment["review_errors"]:
        parts.append(f'<p class="error">{_escape(error)}</p>')
    parts.append('<p>填写 <a href="review-template.json">review-template.json</a>，逐项给出理由与页面证据，再使用 apply-review。'
                 '报告不会覆盖已有模板；若运行或方法改变，使用 review-template --output NEWFILE.json 生成新模板。'
                 '模板和报告绑定本次内容摘要，不能套用到另一次输出。<a href="assessment.json">下载诊断 JSON</a>。</p><nav aria-label="案例导航">')
    parts.extend(f'<a href="#case-{index}">{_escape(output.get("case_id", ""))}</a>' for index, output in enumerate(run.get("cases", [])))
    parts.append('</nav>')
    cases = {case["id"]: case for case in suite["cases"]}
    results = {case["case_id"]: case for case in assessment["cases"]}
    review_cases = review.get("cases", []) if isinstance(review, dict) else []
    if not isinstance(review_cases, list):
        review_cases = []
    reviews = {item["case_id"]: item for item in review_cases
               if isinstance(item, dict) and isinstance(item.get("case_id"), str)}
    for index, output in enumerate(run.get("cases", [])):
        case = cases.get(output.get("case_id"))
        if not case:
            continue
        result = results[case["id"]]
        parts.append(f'<section class="case" id="case-{index}"><h2>{_escape(case["id"])}</h2>'
                     f'<p>执行：{_escape(result["execution_status"])} · 自动诊断：{_escape(result["automatic_gate"])} · '
                     f'评审：{_escape(result["review"]["status"])}</p>{_source(case)}')
        notes = case.get("dimension_notes", {})
        if notes:
            parts.append('<details><summary>本例重点 / Case review focus</summary><ul>')
            for key, rubric in DIMENSIONS.items():
                if key in notes:
                    parts.append(f'<li><strong>{_escape(rubric["label"])}</strong>：{_escape(notes[key])}</li>')
            parts.append('</ul></details>')
        parts.append(_pages(case, output, suite, out))
        if output.get("normalization_checks"):
            parts.append('<details><summary>原始与规范化差异 / Raw-to-normalized diagnostics</summary>'
                         f'<pre style="white-space:pre-wrap;overflow-wrap:anywhere">{_escape(output["normalization_checks"])}</pre></details>')
        if result["geometry"]:
            geometry = result["geometry"]
            parts.append('<h3>固定图片定位诊断</h3><p class="muted">一对一标签匹配，IoU 与中心落点均满足才计入 TP。只适用于此固定图，不代表自然图定位能力。</p>'
                         f'<p>Precision：{geometry["precision"]:.3f} · Recall：{geometry["recall"]:.3f} · TP：{geometry["true_positive"]} / {geometry["expected_count"]}</p>'
                         '<table><thead><tr><th>固定对象</th><th>标签匹配</th><th>IoU</th><th>中心在框内</th></tr></thead><tbody>')
            for row in geometry["annotations"]:
                parts.append(f'<tr><td>{_escape(row["label"])}</td><td>{_escape(row["matched"])}</td>'
                             f'<td>{_escape(row["iou"])}</td><td>{_escape(row["center_in_annotation"])}</td></tr>')
            parts.append('</tbody></table>')
        parts.append('<h3>自动发现 / Automatic findings</h3><ul class="findings">')
        if not result["findings"]:
            parts.append('<li class="passed">未发现结构问题；事实和跨页语义仍需人工核对。</li>')
        for finding in result["findings"]:
            parts.append(f'<li class="{finding["severity"]}"><strong>{_escape(finding["code"])}</strong> '
                         f'{_escape({key: value for key, value in finding.items() if key not in {"code", "severity"}})}</li>')
        parts.append('</ul><h3>人工评审 / Manual review</h3>'
                     + _review_rows(reviews.get(case["id"]), case, invalid=result["review"]["status"] == "invalid"))
        for error in result["review"]["errors"] + result["review"]["failures"]:
            parts.append(f'<p class="error">{_escape(error)}</p>')
        parts.append('</section>')
    parts.append('<section class="case"><h2>0–4 分锚点 / Review anchors</h2>')
    for key, rubric in DIMENSIONS.items():
        parts.append(f'<h3>{_escape(rubric["label"])}</h3><ol start="0">')
        parts.extend(f'<li>{_escape(anchor)}</li>' for anchor in rubric["anchors"])
        parts.append('</ol>')
    parts.append('<p>每维至少 3 分且逐项事实/禁止结论核对通过，才满足本流程接受门槛；不计算平均分。校准评审不能代替真实人工模型质量评审。</p></section>')
    if comparison:
        parts.append('<section class="case"><h2>成对运行对比 / Paired comparison</h2>'
                     f'<pre style="white-space:pre-wrap;overflow-wrap:anywhere">{_escape({key: value for key, value in comparison.items() if key != "case_deltas"})}</pre>')
        for delta in comparison.get("case_deltas", []):
            parts.append(f'<details><summary>{_escape(delta["case_id"])}：正文与诊断对照</summary><div class="pages paired">')
            for key, label in (("base", "基线 / Baseline"), ("candidate", "候选 / Candidate")):
                side = delta[key]
                parts.append(f'<article class="page"><h3>{label}</h3>{_paragraph({field: value for field, value in side.items() if field != "pages"})}')
                for page in side.get("pages", []):
                    parts.append(f'<h4>{_escape(page.get("title", ""))}</h4>{_paragraph(page.get("description", ""))}')
                    for section in page.get("sections", []):
                        parts.append(f'<strong>{_escape(section.get("title", ""))}</strong>{_paragraph(section.get("body", ""))}')
                    parts.append(_paragraph({"hotspots": page.get("hotspot_labels", [])}))
                parts.append('</article>')
            parts.append('</div></details>')
        parts.append('</section>')
    parts.append('<footer><h2>适用边界 / Limits</h2><ul>')
    parts.extend(f'<li>{_escape(item)}</li>' for item in assessment["limitations"])
    parts.append('</ul></footer></main></body></html>')
    (out / "report.html").write_text(''.join(parts))
    return assessment
