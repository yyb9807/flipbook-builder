"""Author-controlled fixtures; no production prompt or model output was consulted."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
VERSION = '1.0.0'
CHECKED = '2026-10-19'

def write(path, value):
    (HERE / path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def ref(id, title, url=None):
    value = dict(id=id, title=title, checked_on=CHECKED)
    if url:
        value['url'] = url
    return value

def anchor(id, claim, excerpt, source='authored-brief', root=False, severity='critical'):
    return dict(id=id, claim=claim, evidence_excerpt=excerpt, source_id=source, severity=severity, applies_to=['root' if root else 'all_pages_if_mentioned'])

def forbid(id, claim, reason, severity='critical'):
    return dict(id=id, claim=claim, reason=reason, severity=severity)

NOTES = {
    'en': {
        'body': 'Assess whether the explanation expresses the supplied relationships correctly and provides useful substance. A matching word is not evidence that the claim is true. Root anchors are mandatory on the overview; conditional anchors apply only when that fact is discussed.',
        'hotspots': 'Judge the promise made by each actual entry label against what its destination explains. For images, separately judge target identity and overlap with visible support. Good geometry cannot rescue the wrong referent.',
        'cross_page': 'Follow the chosen root label into the child, then the chosen child label into the grandchild. Each page should add a useful distinction, condition, or implication while preserving quantities, event anchors, qualifications, and evidence limits. Paraphrase alone is not added depth; invented worked examples are not required.',
        'instruction': 'Use the case language. Separate supplied facts, clearly stated inference, invented test conventions, and missing information. Evaluation anchors and controlled replays are reviewer resources and must never be appended to generation input.'
    },
    'zh': {
        'body': '判断解释是否准确表达材料中的关系且有实质内容。出现相同词语不等于语义正确。标为根页的事实必须在总览交代；条件事实仅在提及时逐页核对。',
        'hotspots': '依据实际入口标签对读者作出的内容承诺评审目标页。图像热点另行检查目标身份和可见区域覆盖；矩形位置正确不能补救标签指错对象。',
        'cross_page': '沿根页选中标签追踪子页，再沿子页标签追踪孙页。每层应增加有用的区分、条件或推论，并保持数量、计时事件、限定和证据边界。换一种说法不等于深入，不要求编造具体案例。',
        'instruction': '保持案例语言，区分材料事实、明确标注的推论、虚构测试规则与缺失信息。评审锚点和受控回放只供评审使用，禁止追加到生成输入。'
    }
}

BRIEF = {
    'en': '''Aurora Map Digitization Desk is an invented service for this closed-world test. Use only the following rules; they are not real service policy.
Intake and batch size: a batch contains at most 5 paper map sheets. Customer upload of a request is not the intake event. Intake occurs when an operator scans the batch ticket.
Inspection clock: the format inspection must finish within 16 minutes after that operator scan. This inspection window is not a promise that the output is ready in 16 minutes.
Release and retention: output may be released only after BOTH the map review and the output checksum check have passed. Passing just one check is insufficient. A failed checksum blocks release. The 36-hour output-retention window starts when the checksum check passes, even if map review is still pending; it does not start at the request, intake, or first download. Downloading does not restart this window.
Retention clock: once that 36-hour window ends, the stored output is deleted. The brief defines no extension, recovery, retry process, fee, rush option, scanning resolution, opening hours, location, calendar date, or handling of a job whose map review remains pending at deletion. Preserve these gaps rather than promising an outcome. Explain a deeper branch through the conditions and clocks without inventing a customer's case.''',
    'zh': '''极光地图数字化台是为本封闭测试虚构的服务，只能使用下述规则，不可当成真实服务政策。
接收与批次：每批最多包含 5 张纸质地图。客户上传申请不算接收；操作员扫描批次单时才算接收。
检查时钟：格式检查必须在操作员扫描后的 16 分钟内完成。这段检查窗口不保证输出会在 16 分钟内准备就绪。
交付与保留：地图内容审核和输出校验和检查必须两项都通过，输出才可以交付。只通过其中一项不够，校验和失败会阻止交付。输出的 36 小时保留窗口从校验和检查通过时开始，即使地图内容审核仍待完成；不从申请、接收或首次下载开始。下载不会重启保留窗口。
保留时钟：36 小时窗口结束后，存储的输出将被删除。材料未规定延期、恢复、重试流程、费用、加急选项、扫描分辨率、开放时间、地点、日历日期，以及删除时内容审核仍待完成的作业如何处理。必须保留这些未知，不可承诺结果。深入分支可解释条件和时钟，不必编造客户个案。'''
}

SCIENCE = {
    'en': '''This original summary explains lunar phases using NASA's public science accounts. It is a mechanism brief, not an observation record or a forecast.
Light and viewpoint: moonlight is reflected sunlight. Outside a lunar eclipse, the Sun illuminates roughly half of the Moon; ordinary phases change because an Earth observer sees a changing portion of that sunlit half as the Moon orbits. Ordinary phases are not produced by Earth's shadow.
Two different cycles: the Moon completes an orbit around Earth in about 27.3 days, but one new Moon to the next takes about 29.5 days. These are approximate durations of different cycles, not rival measurements of one identical interval.
Moving Sun direction: while the Moon completes an orbit, Earth and Moon also move around the Sun. Restoring the new-Moon geometry therefore requires more motion than completing that orbit alone.
Phases and eclipses: a lunar eclipse requires the Moon to enter Earth's shadow at full Moon. Full Moon alone does not guarantee an eclipse because the lunar orbit is tilted relative to Earth's orbital plane.
No date, observing location, measured brightness, weather, or ephemeris is supplied. Do not infer today's phase, an exact next-phase time, a local viewing direction, or an eclipse date. A deeper explanation may compare reference geometry and necessary versus sufficient conditions without adding an observation.''',
    'zh': '''本原创摘要依据 NASA 的公开科学说明解释月相机制。它是机制材料，不是观测记录或预报。
光照与视角：月光是反射的太阳光。月食之外，太阳大致照亮月球的一半；月球绕地球运行时，地球观察者看到的受光部分比例改变，因此产生普通月相。普通月相不是地球影子造成的。
两种不同周期：月球绕地球完成一圈约需 27.3 天，而从一次新月到下一次新月约需 29.5 天。这是两个不同周期的近似时长，并非同一个时间间隔的两个相互矛盾的测量值。
太阳方向的改变：月球绕地球运行一圈的同时，地月系统也在绕太阳运动。因此，恢复新月时的相对位置关系，需要比完成那一圈更多的运动。
月相与月食：月食要求月球在满月时进入地球影子。仅有满月不保证月食，因为月球轨道相对地球公转轨道平面有倾斜。
材料未提供日期、观测地点、亮度测量、天气或星历。不可推断今天的月相、下一月相的精确时刻、当地观测方向或月食日期。深入解释可以比较参照几何关系，以及必要条件和充分条件，不必添加观测个案。'''
}
SCI_REFS = [
    ref('nasa-phases', 'NASA Science — Moon Phases', 'https://science.nasa.gov/moon/moon-phases/'),
    ref('nasa-questions', 'NASA Science — Top Moon Questions', 'https://science.nasa.gov/moon/top-moon-questions/'),
    ref('nasa-eclipses', 'NASA Science — Eclipses and the Moon', 'https://science.nasa.gov/moon/eclipses/')
]

def text_case(id, lang, title, text, kind, references, steps, facts, forbidden, unknown):
    return dict(schema_version=1, id=id, version=VERSION, language=lang, title=title,
                input=dict(kind='text', text=text),
                source=dict(kind=kind, text=text, license='MIT', notes='Original contributor-authored bilingual prose. Public references support the scientific relationships; no external page is needed at generation time. This source text is exactly the visible text input. No production prompt, live run, review output, or optimization plan was consulted.', references=references),
                branch_steps=[dict(preferred_labels=step) for step in steps], fact_checks=facts,
                forbidden_claims=forbidden, unknown_limits=unknown, dimension_notes=NOTES[lang])

for lang in ('zh', 'en'):
    zh = lang == 'zh'
    case = text_case('map-desk-' + lang, lang, '虚构地图数字化：条件与时钟' if zh else 'Fictional map digitization: conditions and clocks', BRIEF[lang], 'synthetic-closed-world', [ref('authored-brief', 'Original closed-world map-digitization service; not a real organization')],
        [['交付与保留', '交付条件与保留', '输出交付'] if zh else ['Release and retention', 'Release conditions and retention', 'Output release'], ['保留时钟', '保留窗口', '保留计时'] if zh else ['Retention clock', 'Retention window', 'Retention timing']],
        [anchor('batch-maximum', '每批上限为 5 张纸质地图，不是必须凑满 5 张或每日上限。' if zh else 'The maximum is 5 paper map sheets per batch; it is neither a minimum nor a daily limit.', '每批最多包含 5 张纸质地图' if zh else 'a batch contains at most 5 paper map sheets', root=True),
         anchor('inspection-start', '16 分钟检查窗口从操作员扫描批次单开始，并不保证交付。' if zh else 'The 16-minute inspection window starts at the operator scan and is not an output-ready promise.', '格式检查必须在操作员扫描后的 16 分钟内完成。这段检查窗口不保证输出会在 16 分钟内准备就绪。' if zh else 'the format inspection must finish within 16 minutes after that operator scan. This inspection window is not a promise that the output is ready in 16 minutes.'),
         anchor('release-conjunction', '交付要求内容审核和校验和检查两项都通过；一项通过不够。' if zh else 'Release requires both map review and checksum check to pass; either alone is insufficient.', '地图内容审核和输出校验和检查必须两项都通过，输出才可以交付。只通过其中一项不够' if zh else 'output may be released only after BOTH the map review and the output checksum check have passed. Passing just one check is insufficient.', root=True),
         anchor('retention-start', '36 小时从校验和通过起计，即使审核未完成；不因下载重启。' if zh else 'The 36-hour window starts on checksum pass even while review is pending, and download does not reset it.', '输出的 36 小时保留窗口从校验和检查通过时开始，即使地图内容审核仍待完成；不从申请、接收或首次下载开始。下载不会重启保留窗口。' if zh else 'The 36-hour output-retention window starts when the checksum check passes, even if map review is still pending; it does not start at the request, intake, or first download. Downloading does not restart this window.'),
         anchor('end-state', '保留窗口结束后删除存储输出，不能把它说成永久保留。' if zh else 'Stored output is deleted at the end of the retention window rather than kept permanently.', '36 小时窗口结束后，存储的输出将被删除。' if zh else 'once that 36-hour window ends, the stored output is deleted.')],
        [forbid('inspection-as-delivery', '16 分钟内保证输出交付。' if zh else 'Output release is guaranteed within 16 minutes.', '检查期限不等于交付承诺。' if zh else 'This turns an inspection deadline into a delivery guarantee.'),
         forbid('retention-shift', '两项都通过或首次下载后才开始计 36 小时。' if zh else 'The 36 hours start only after both checks pass or after first download.', '保留时钟独立锚定校验和检查通过。' if zh else 'The retention clock is independently anchored to checksum pass.'),
         forbid('one-check-release', '任意一项检查通过就能交付，或校验和失败仍可交付。' if zh else 'Passing either check permits release, or a failed checksum still permits release.', '这破坏双条件及失败门槛。' if zh else 'This breaks the conjunction and failed-check gate.'),
         forbid('invented-recovery', '删除后必可恢复，或待审核作业自动延期。' if zh else 'Deleted outputs are guaranteed recoverable, or pending review automatically extends retention.', '恢复、延期与待审核的处理没有定义。' if zh else 'Recovery, extensions, and the pending-review outcome are undefined.', severity='major')],
        ['延期、恢复、重试、费用、加急、分辨率、开放时间、地点、具体日期，以及删除时仍待审核的作业如何处理。' if zh else 'Extensions, recovery, retries, fees, rush processing, resolution, hours, location, dates, and the disposition of a job still awaiting review at deletion.'])
    write('cases/' + case['id'] + '.json', case)
    case = text_case('lunar-geometry-' + lang, lang, '月相：光照、参照与条件' if zh else 'Lunar phases: illumination, reference geometry, and conditions', SCIENCE[lang], 'primary-source-summary', SCI_REFS,
        [['两种不同周期', '两种周期', '轨道与月相周期'] if zh else ['Two different cycles', 'Two cycles', 'Orbital and phase cycles'], ['太阳方向的改变', '太阳方向', '参照方向的改变'] if zh else ['Moving Sun direction', 'Changing Sun direction', 'Changing reference direction']],
        [anchor('reflected-light', '月光为反射太阳光，普通月相取决于观察到的受光比例。' if zh else 'Moonlight is reflected sunlight, and ordinary phase depends on the visible portion of the sunlit half.', '月光是反射的太阳光。月食之外，太阳大致照亮月球的一半；月球绕地球运行时，地球观察者看到的受光部分比例改变，因此产生普通月相。' if zh else 'moonlight is reflected sunlight. Outside a lunar eclipse, the Sun illuminates roughly half of the Moon; ordinary phases change because an Earth observer sees a changing portion of that sunlit half as the Moon orbits.', source='nasa-phases', root=True),
         anchor('different-cycles', '27.3 天与 29.5 天分别是轨道一圈与新月到新月的近似周期，不能互换或当成精确承诺。' if zh else 'About 27.3 days is an orbital loop and about 29.5 days is new Moon to new Moon; the approximations and cycle identities must be preserved.', '月球绕地球完成一圈约需 27.3 天，而从一次新月到下一次新月约需 29.5 天。' if zh else 'the Moon completes an orbit around Earth in about 27.3 days, but one new Moon to the next takes about 29.5 days.', source='nasa-questions'),
         anchor('moving-geometry', '地月系统绕太阳运动，使恢复新月几何关系需要额外运动。' if zh else 'Earth-Moon motion around the Sun makes restoring new-Moon geometry require additional motion beyond the orbital loop.', '月球绕地球运行一圈的同时，地月系统也在绕太阳运动。因此，恢复新月时的相对位置关系，需要比完成那一圈更多的运动。' if zh else 'while the Moon completes an orbit, Earth and Moon also move around the Sun. Restoring the new-Moon geometry therefore requires more motion than completing that orbit alone.', source='nasa-questions'),
         anchor('eclipse-condition', '普通月相不是地影；满月是月食条件之一，但单独不充分。' if zh else 'Ordinary phases are not Earth shadow; full Moon is necessary for a lunar eclipse but insufficient on its own.', '月食要求月球在满月时进入地球影子。仅有满月不保证月食，因为月球轨道相对地球公转轨道平面有倾斜。' if zh else "a lunar eclipse requires the Moon to enter Earth's shadow at full Moon. Full Moon alone does not guarantee an eclipse because the lunar orbit is tilted relative to Earth's orbital plane.", source='nasa-eclipses', root=True)],
        [forbid('phase-earth-shadow', '普通月相由地球遮住太阳光而形成。' if zh else "Earth's shadow creates ordinary lunar phases.", '把观测到的受光比例误当成月食遮挡。' if zh else 'This confuses viewing geometry with eclipse shadowing.'),
         forbid('cycle-swap', '新月到新月为 27.3 天、绕地球一圈为 29.5 天，或每次周期精确相同。' if zh else 'New Moon to new Moon is 27.3 days and an orbit is 29.5 days, or each duration is exact and invariant.', '周期对象和近似限定必须保留。' if zh else 'The cycle identities and approximate qualifiers must survive.'),
         forbid('every-full-eclipse', '每次满月都会发生月食。' if zh else 'Every full Moon produces a lunar eclipse.', '忽略倾斜轨道和进入地影的额外条件。' if zh else 'This drops orbital tilt and the need to enter the shadow.'),
         forbid('invented-observation', '材料足以判断今天月相或精确预报当地月食与观测方向。' if zh else "The brief establishes today's phase or an exact local eclipse time and viewing direction.", '没有日期、地点或星历。' if zh else 'No date, location, or ephemeris is supplied.', severity='major')],
        ['今天月相、精确的下一月相时刻、月食日期、当地观测方向、实测亮度与天气。' if zh else "Today's phase, exact next-phase time, eclipse date, local viewing direction, measured brightness, and weather."])
    write('cases/' + case['id'] + '.json', case)

geometry = json.loads((HERE / 'assets/geometry.json').read_text())
G = {entry['id']: entry for entry in geometry['objects']}
IMAGE_TEXT = {
    'en': 'An original flat-color scene on a pale background contains five shapes of unequal size at irregular positions: a purple ring at upper left, an orange vertical capsule at upper right, a large blue irregular quadrilateral across the center and lower area, a coral horizontal bar at lower left, and a smaller green star at lower right. The coral bar is drawn over part of the blue shape. The ring has a background-colored opening. The image supplies no physical scale, material, function, provenance of real objects, or temporal event.',
    'zh': '浅色背景上的原创平涂场景包含五个大小不同、位置不规则的形状：左上紫色圆环、右上橙色竖向胶囊形、横跨中部和下部的蓝色不规则四边形、左下珊瑚色横条，以及右下较小的绿色星形。珊瑚色横条覆盖蓝色形状的一部分。圆环中央开口呈背景色。图中未提供物理比例尺、材料、功能、真实物品来源或发生时间。'
}
LABELS = {
    'en': [('purple-ring', 'Purple ring', ['purple annulus', 'violet ring']), ('orange-capsule', 'Orange vertical capsule', ['orange capsule', 'vertical orange pill shape']), ('blue-quadrilateral', 'Blue irregular quadrilateral', ['blue quadrilateral', 'large blue four-sided shape']), ('coral-bar', 'Coral horizontal bar', ['coral bar', 'salmon-colored rectangle', 'coral rectangle']), ('green-star', 'Green star', ['green five-pointed star', 'small green star'])],
    'zh': [('purple-ring', '紫色圆环', ['紫色环形', '紫色环']), ('orange-capsule', '橙色竖向胶囊形', ['橙色胶囊形', '橙色竖形']), ('blue-quadrilateral', '蓝色不规则四边形', ['蓝色四边形', '蓝色大形状']), ('coral-bar', '珊瑚色横条', ['珊瑚色长方形', '珊瑚红横条', '橙红色横条']), ('green-star', '绿色星形', ['绿色五角星', '绿色小星形'])]
}
for lang in ('zh', 'en'):
    zh = lang == 'zh'
    case = dict(schema_version=1, id='occluded-layout-' + lang, version=VERSION, language=lang, title='原创多尺度遮挡场景' if zh else 'Original multiscale scene with occlusion', input=dict(kind='image', image_path='assets/scene.png', sha256=geometry['png_sha256'], width=geometry['width'], height=geometry['height']),
        source=dict(kind='original-synthetic-image', text=IMAGE_TEXT[lang], license='MIT', notes='One independently authored language-neutral scene, reused in Chinese and English. Original Pillow generator and visible-support pixel records are in assets/. Five unequal, irregularly placed shapes include partial occlusion; no third-party image, real photo, or image model was used. Reviewer annotations are not generation context. This synthetic scene does not establish natural-image generalization.', references=[ref('original-scene', 'Original five-shape occlusion scene; deterministic repository-native generator, MIT')]),
        branch_steps=[dict(preferred_labels=['蓝色不规则四边形', '蓝色四边形', '蓝色大形状'] if zh else ['Blue irregular quadrilateral', 'Blue quadrilateral', 'Large blue four-sided shape']), dict(preferred_labels=['遮挡与可见边界', '遮挡关系', '可见边界'] if zh else ['Occlusion and visible boundary', 'Occlusion', 'Visible boundary'])],
        fact_checks=[anchor('five-targets', '总览应区分五个不同对象，包括圆环开口和较小星形。' if zh else 'The overview should distinguish all five targets, including the ring opening and the smaller star.', '浅色背景上的原创平涂场景包含五个大小不同、位置不规则的形状：左上紫色圆环、右上橙色竖向胶囊形、横跨中部和下部的蓝色不规则四边形、左下珊瑚色横条，以及右下较小的绿色星形。' if zh else 'An original flat-color scene on a pale background contains five shapes of unequal size at irregular positions: a purple ring at upper left, an orange vertical capsule at upper right, a large blue irregular quadrilateral across the center and lower area, a coral horizontal bar at lower left, and a smaller green star at lower right.', source='original-scene', root=True),
            anchor('occlusion-order', '珊瑚色横条在重叠处覆盖蓝色形状，不能反转。' if zh else 'The coral bar covers the blue shape in the overlapping region; the visible stacking order cannot be reversed.', '珊瑚色横条覆盖蓝色形状的一部分。' if zh else 'The coral bar is drawn over part of the blue shape.', source='original-scene'),
            anchor('ring-opening', '圆环中间开口呈背景色，不能称为实心圆。' if zh else 'The ring has a background-colored opening, so it should not be described as a solid disk.', '圆环中央开口呈背景色。' if zh else 'The ring has a background-colored opening.', source='original-scene', severity='major')],
        forbidden_claims=[forbid('reverse-overlap', '蓝色形状在重叠处覆盖珊瑚色横条。' if zh else 'The blue shape covers the coral bar in the overlapping area.', '与可见绘制顺序相反。' if zh else 'This reverses the visible stacking order.'), forbid('hidden-completion', '图中可精确看出被遮住部分的纹理、损坏或结构。' if zh else 'The image precisely reveals texture, damage, or construction beneath the bar.', '被遮住部分没有可见证据。' if zh else 'Covered pixels supply no visible evidence.', severity='major'), forbid('physical-invention', '图中证明这些是真实材料制成、具有确定尺寸或用途的物品。' if zh else 'The image establishes real materials, physical dimensions, or intended use.', '原创平面图未提供实物属性。' if zh else 'This original flat illustration supplies no physical-object evidence.', severity='major')],
        unknown_limits=['物理比例尺、材料、质量、实际用途、历史、被遮挡区域的细节。' if zh else 'Physical scale, material, mass, real-world use, history, and the details of covered regions.'], dimension_notes=NOTES[lang], expected_hotspots=[dict(id=name, label=label, aliases=aliases, box=G[name]['box'], required=True) for name, label, aliases in LABELS[lang]], iou_threshold=0.5, independent_visual_scene_id='irregular-occlusion-v1')
    write('cases/' + case['id'] + '.json', case)

# Controlled responses are authored independently, using only the visible briefs.
# Their purpose is offline plumbing/semantic-review demonstrations, never a score.
def page(title, description, sections):
    return dict(title=title, description=description, layout='sequence', sections=[dict(title=t, body=b) for t, b in sections], subject_en='Source-grounded educational explanation', composition_type='diagram', sub_topics_en=['main distinction', 'conditions and relationships', 'evidence limits'])

REPLAY = {}
REPLAY['map-desk-en'] = {
    'root': page('A fictional map-digitization process', 'Keep intake, checks, release, and deletion on their stated event anchors.', [
        ('Intake and batch size', 'The invented desk accepts batches of at most 5 paper map sheets. A customer uploading a request does not start intake. Intake occurs at the operator scan of the batch ticket, so a request and a received batch are different states.'),
        ('Inspection clock', 'Format inspection must finish within 16 minutes of the operator scan. That deadline concerns inspection only. It cannot be carried across to a promise that the final output is ready or releasable within the same time.'),
        ('Release and retention', 'Release needs both map review and output checksum check to pass. A failed checksum blocks release. Independently, the 36-hour retention window begins on checksum pass, even if review is pending; downloading cannot reset it. Stored output is deleted when that window ends, and recovery or extensions are unspecified.')]),
    'child': page('Release permission and retention are separate', 'The selected branch contains a two-check gate and a clock with a different trigger.', [
        ('Release gate', 'Map review and checksum verification are separate conditions joined by AND. Neither approval alone grants permission to release. A failed checksum blocks release rather than merely shortening retention. Inspection completion should not be substituted for either stated release condition.'),
        ('Retention clock', 'Checksum pass starts the 36-hour retention window even while map review remains pending. This means the retention clock can be running before release becomes permitted. The first download is neither its start nor a reset, so download activity does not create a fresh window.'),
        ('Unspecified outcomes', 'Deletion follows the end of the retention window. The rules do not settle how to handle a job whose map review is still pending at that moment. Explaining the independence of permission and retention is useful; promising an automatic extension or a recovery route would fill a missing policy.')]),
    'grandchild': page('Reasoning about the retention clock', 'Use event identity and elapsed duration without inventing a customer timeline.', [
        ('Start event', 'The checksum pass is the event that creates the retention start. Intake, application, review approval, and download are different events and cannot silently replace it. Even if review is still pending, the supplied retention trigger remains checksum pass.'),
        ('Elapsed window', 'The window lasts 36 hours from that trigger. A later download does not move the start forward, so repeated downloads cannot be used to infer repeated 36-hour extensions. An exact calendar deadline would require a supplied timestamp, which this material does not contain.'),
        ('End and limits', 'The stored output is deleted when the window ends. The release gate still requires both approvals; it does not itself guarantee delivery before deletion. The disposition of a pending-review job, extensions, and recovery are undefined and must remain open questions.')])}
REPLAY['map-desk-zh'] = {
    'root': page('虚构地图数字化流程', '把接收、检查、交付和删除分别锚定到材料定义的事件。', [
        ('接收与批次', '这项虚构服务每批最多处理 5 张纸质地图。客户上传申请并不等于接收；操作员扫描批次单才是接收事件。因此不能把提交申请和批次已被接收当成同一状态。'),
        ('检查时钟', '格式检查应在操作员扫描后的 16 分钟内完成。这个时限只约束检查，不能扩展成最终输出会在同样时间内准备好或获准交付的承诺。'),
        ('交付与保留', '交付要求地图内容审核和输出校验和检查都通过；校验和失败会阻止交付。36 小时保留窗口独立地从校验和通过起计，即使审核仍待完成，下载也不会重启。窗口结束会删除存储输出，恢复和延期没有规定。')]),
    'child': page('交付许可与保留期限分别判断', '这个分支同时包含双条件门槛和另有触发事件的时钟。', [
        ('交付门槛', '内容审核与校验和检查是两个独立条件，用“并且”连接。一项通过不能授予交付许可。校验和失败的结果是阻止交付，不能改写成只缩短保留期限；格式检查完成也不能替代这两个条件。'),
        ('保留时钟', '校验和通过就启动 36 小时保留窗口，即使内容审核尚未完成。由此可区分“保留已开始”和“交付已获准”：前者可以先发生。首次下载既不是起点也不是重置按钮，下载活动不能创造新窗口。'),
        ('尚未定义的结果', '保留窗口结束后删除存储输出，但规则没有解决删除时仍待审核的作业如何处置。说明许可与保留互相独立有助于理解；承诺自动延期或恢复途径则会补造政策。')]),
    'grandchild': page('沿事件理解保留时钟', '不编造客户时间线，也能解释起点、经过时长与终点。', [
        ('起点事件', '校验和检查通过才建立保留起点。申请、接收、内容审核通过和下载是别的事件，不能悄悄替换它。即使内容审核仍待完成，已定义的触发事件仍然是校验和通过。'),
        ('经过窗口', '从该触发事件起经过 36 小时才到窗口终点。之后下载不会把起点向后移动，所以重复下载不能被解释为重复获得 36 小时延期。计算具体日历截止时刻还需要起点时间戳，而材料没有给出。'),
        ('终点与边界', '窗口结束后存储输出被删除。交付仍须两项都通过，这个门槛本身并不保证在删除前完成交付。对待审核作业的后续处理、延期和恢复都没有定义，应继续保留未知。')])}
REPLAY['lunar-geometry-en'] = {
    'root': page('The geometry behind lunar phases', 'Separate sunlight, orbital repetition, and eclipse conditions.', [
        ('Light and viewpoint', 'Moonlight reflects sunlight. Outside an eclipse, roughly half the Moon is sunlit, while an Earth observer sees a changing portion of that half during the orbit. Ordinary phases describe this change in view rather than a shadow of Earth moving across the Moon.'),
        ('Two different cycles', 'An orbit around Earth takes about 27.3 days; new Moon to new Moon takes about 29.5. The durations refer to different repetitions. Earth and Moon move around the Sun during an orbit, so restoring new-Moon geometry takes further motion.'),
        ('Phases and eclipses', 'A lunar eclipse requires entry into Earth\'s shadow at full Moon. Full Moon by itself is insufficient because the lunar orbit is tilted relative to Earth\'s orbital plane. This mechanism brief contains no date, location, or ephemeris from which to predict a local event.')]),
    'child': page('Why the two cycles differ', 'A completed orbit and a repeated phase answer different geometric questions.', [
        ('Orbital loop', 'About 27.3 days describes one orbit around Earth. About 29.5 days describes a return from one new Moon to the next. The difference is meaningful because the two endpoints ask for different repetitions, and both figures remain approximate.'),
        ('Moving Sun direction', 'During the orbital loop, Earth and Moon also travel around the Sun. Repeating the orbital loop alone therefore does not restore the former relative geometry with the Sun. Additional motion is needed to return to the new-Moon arrangement.'),
        ('What cannot be dated', 'The mechanism explains why the phase cycle is longer without establishing a calendar schedule. No starting timestamp, observing site, or ephemeris is provided. A deeper explanation can compare the two reference questions without fabricating an observation or predicting the next new Moon.')]),
    'grandchild': page('A moving reference for the phase cycle', 'Track which relationship has to repeat before treating two cycles as equivalent.', [
        ('What repeats', 'Finishing an orbit around Earth is one criterion. Restoring the new-Moon relationship with the Sun is another. Treating them as identical would discard the fact that the Earth-Moon system also moves around the Sun during the orbit.'),
        ('Why further motion matters', 'When that solar relationship has changed, completion of the orbital loop alone is not enough to repeat the phase. This supplied geometric reason supports a longer approximate phase cycle; it does not turn the two approximate durations into exact fixed deadlines.'),
        ('Boundary of the explanation', 'The argument concerns ordinary phase geometry, not Earth\'s shadow. A lunar eclipse still needs entry into the shadow at full Moon, and full Moon alone remains insufficient. None of these relationships supplies an exact date or a local viewing direction.')])}
REPLAY['lunar-geometry-zh'] = {
    'root': page('月相背后的几何关系', '分别理解太阳光、轨道重复与月食条件。', [
        ('光照与视角', '月光反射自太阳光。月食之外，月球大致有一半受光，地球观察者在月球绕行时看到这一受光部分的不同比例。普通月相描述视角关系的改变，不能解释成地球影子在月面移动。'),
        ('两种不同周期', '绕地球一圈约为 27.3 天，新月到下一次新月约为 29.5 天，两者对应不同的重复关系。绕行一圈期间地月系统也在绕太阳运动，因此恢复新月几何关系还需要额外运动。'),
        ('月相与月食', '月食要求月球在满月时进入地球影子。满月本身不充分，因为月球轨道相对地球公转轨道平面存在倾斜。这份机制材料没有日期、地点或星历，不能用来预报当地事件。')]),
    'child': page('两种周期为何不同', '完成绕行和重复月相，回答的是两个几何问题。', [
        ('绕地球一圈', '约 27.3 天描述绕地球完成一圈，约 29.5 天描述从一次新月回到下一次新月。两种终点要求重复的关系不同，所以时长差异有意义，而两个数值都继续保留“约”的限定。'),
        ('太阳方向的改变', '在绕行期间，地月系统也绕太阳运动。因此仅完成绕地球一圈，并没有恢复原先相对于太阳的几何关系；回到新月排列还需要更多运动。这个解释取决于参照关系，而不是给同一个间隔两个数值。'),
        ('不能据此定日期', '机制能够解释月相周期为何较长，却不能建立日历安排。材料没有起点时间戳、观测地点或星历。深入分支可比较两个参照问题，无须编造观测记录或预测下一次新月。')]),
    'grandchild': page('月相周期的移动参照', '先辨认必须重复的关系，再判断周期是否等价。', [
        ('重复的对象', '完成绕地球的一圈是一种判据，恢复相对于太阳的新月关系是另一种判据。把二者视为完全相同，会丢掉地月系统在绕行期间也绕太阳运动这一条件。'),
        ('额外运动的作用', '当相对于太阳的关系发生改变，轨道一圈的完成就不足以重复原月相。材料给出的几何原因支持较长的近似月相周期，但不会把两个近似时长变成精确且固定的截止期限。'),
        ('解释的边界', '这里解释普通月相的几何关系，不是地球影子。月食仍要求满月时进入地影，满月单独仍不充分。这些关系都不能补足精确日期或当地观测方向。')])}

for lang in ('zh', 'en'):
    zh = lang == 'zh'
    hotspots = [dict(id='hs_' + str(i), label=label, **G[name]['box']) for i, (name, label, aliases) in enumerate(LABELS[lang], start=1)]
    root = dict(summary=IMAGE_TEXT[lang], scene_type='abstract', language_hint=lang, hotspots=hotspots, keywords=[dict(label=label, description='观察可见的颜色、轮廓、位置与遮挡。' if zh else 'Observe visible color, contour, position, and overlap.') for name, label, aliases in LABELS[lang]])
    if zh:
        child = page('观察蓝色四边形', '把可见形状、遮挡关系与推测分开。', [
            ('颜色与范围', '较大的蓝色形状横跨画面中部和下部，与左上的紫色圆环、右上的橙色胶囊形和右下较小的绿色星形不同。入口标签应指向这个蓝色对象，而不是把邻近对象合并成同一个热点。'),
            ('遮挡与可见边界', '左下珊瑚色横条覆盖蓝色形状的一部分。在重叠位置看见的是横条，因此可说明横条位于前层，却不能声称看到了横条下方的蓝色表面细节。被遮挡不等于图形已经损坏。'),
            ('证据边界', '图像可支持颜色、相对位置和可见轮廓的描述，但没有物理比例尺或实物来源。蓝色填色不能证明材料、厚度、重量或用途，进一步解释仍应保留这些未知。')])
        grandchild = page('遮挡与可见证据', '继续追踪横条和蓝色区域的关系。', [
            ('前后关系', '在重叠区域，珊瑚色横条覆盖蓝色形状，不能把前后关系反转。这里的“前层”描述平面绘制的覆盖顺序，不证明存在有厚度的真实物体。'),
            ('边界与覆盖', '可见蓝色区域在横条处中断，表示有一部分被遮住。框选可以概括可见区域的外部范围，但矩形本身不能揭示遮挡下面的轮廓或纹理，也不能把蓝色对象改变成长方形。'),
            ('保留未知', '描述遮挡已经提供了比重述颜色更多的信息，无须补造被遮部分的结构、真实尺寸或制作历史。该原创平面场景只提供可见的图形证据。')])
    else:
        child = page('Observing the blue quadrilateral', 'Separate visible shape and overlap from unsupported physical interpretations.', [
            ('Color and extent', 'The large blue shape spans the central and lower image, distinct from the upper-left purple ring, upper-right orange capsule, and smaller lower-right green star. An entry label should point to this blue target rather than merge its neighbors into one hotspot.'),
            ('Occlusion and visible boundary', 'The coral bar at lower left covers part of the blue shape. The overlap shows the bar on top, but it cannot reveal details of the blue surface beneath it. Being covered is not evidence that the shape is damaged or cut away.'),
            ('Evidence limits', 'Color, relative position, and visible contour can be described from this image. There is no physical scale or real-object provenance. Blue fill does not establish material, thickness, weight, or purpose, and these limits should remain in a deeper explanation.')])
        grandchild = page('Occlusion and visible evidence', 'Follow the relationship between the bar and the blue region.', [
            ('Layer relationship', 'The coral bar covers the blue shape at the overlap, so the visible order cannot be reversed. Here, being on top describes coverage in a flat drawing; it does not establish real objects with physical thickness.'),
            ('Boundary and coverage', 'The visible blue region is interrupted at the bar because some of it is covered. A box can summarize the outer extent of visible support, but the rectangle cannot reveal hidden contour or texture, nor does it make the blue target rectangular.'),
            ('Keeping the unknowns', 'Explaining overlap adds a useful relationship beyond repeating the color. It requires no invented hidden construction, real dimensions, or manufacturing history. This original flat scene supports only the visible graphic evidence.')])
    REPLAY['occluded-layout-' + lang] = dict(root=root, child=child, grandchild=grandchild)

write('replay.json', dict(schema_version=1, suite_id='quality-holdout-v1', origin='contributor-authored-controlled-replay', responses=REPLAY))
write('suite.json', dict(schema_version=1, id='quality-holdout-v1', version=VERSION, title='Independently curated bilingual holdout for content, grounding, and continuity', created_on=CHECKED, license='MIT', description='Six previously unused cases: two original text families plus one original five-target visual scene, each in Chinese and English, with three stages per case. Controlled replays validate offline plumbing; they are not real model outputs or quality scores.', independent_visual_scenes=1, stages=['root', 'child', 'grandchild'], case_files=['cases/' + name + '-' + lang + '.json' for name in ('map-desk', 'lunar-geometry', 'occluded-layout') for lang in ('zh', 'en')], recordings_path='replay.json', recording_origin='contributor-authored-controlled-replay', limitations=['A six-case holdout with three content families is a small regression sample, not a statistical model ranking.', 'Chinese and English image cases share one scene; they are not two independent visual scenes.', 'Five unequal, irregularly placed targets and partial occlusion broaden geometry coverage but do not establish natural-photo performance.', 'Controlled replay is contributor-authored and must never be represented as live-model quality evidence.', 'Do not expose review anchors, geometry records, replays, or authoring code to generation. Freeze model and implementation candidates before inspecting holdout inputs.']))
