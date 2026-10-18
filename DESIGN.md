---
name: Flipbook Builder
description: 免账号、可校正、可离线阅读的视觉知识工作台
colors:
  accent: "#166a59"
  accent-hover: "#105342"
  accent-soft: "#e8f2ed"
  background: "#f5f7f5"
  surface: "#fff"
  ink: "#20302b"
  muted: "#5b6b64"
  tertiary: "#68766f"
  separator: "#dce3de"
  field-border: "#cbd6ce"
  neutral-soft: "#f0f4f1"
  neutral-hover: "#e8ede9"
  success: "#247044"
  danger: "#b33430"
  warning: "#905a17"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "32px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-.025em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "19px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-.025em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "13px"
    fontWeight: 600
  button:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.35
rounded:
  utility: "6px"
  compact: "7px"
  control: "8px"
  surface: "12px"
spacing:
  two: "8px"
  three: "12px"
  four: "16px"
  five: "20px"
  six: "24px"
  seven: "28px"
  eight: "32px"
  ten: "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-text:
    textColor: "{colors.accent}"
    padding: "4px 0"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    rounded: "{rounded.compact}"
    padding: "7px 10px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
  hotspot:
    textColor: "{colors.ink}"
    width: "44px"
    height: "44px"
---

# Design System: Flipbook Builder

## Overview

**Creative North Star: "观察工作台"**

作品是观察对象，页面目录、热点与内容检查器是工具。浅矿物白承托深墨色文字，海绿色标明可操作方向；界面以清楚的边界、对齐和低噪声状态提示支持创作，不以装饰竞争内容。首页先给主题/图片起点与明确标记的示例，再呈现已有作品；编辑器把页面结构、画布与检查器放在同一工作环境。

这是按现有实现记录的系统。描述依据 `frontend/src/index.css`、设置与场景样式、Home/Builder/Settings/Scene 组件及2026-10-18的浏览器验收，见[正式整栈截图](docs/images/round5-final-official-stack.jpg)和[验收说明](docs/VERIFICATION.md)。产品身份和中文系统字体取自既有约束。内容插图可有自己的颜色，工作台工具保持统一。

**Key Characteristics:**

- 内容先于配置：示例、手动知识页和手动图片标注可独立开始。
- 扁平、分区明确的工具界面；色彩承担操作与状态语义。
- 中文与英文共用系统无衬线字体，标题适度放大，辅助信息退后。
- 图片自然比例与结构化 DOM 内容共同构成作品；编辑、预览和离线播放器共用渲染规则。
- 保存、草稿、浏览器本地副本和服务连接状态有可读文字。
- 根页分析、子页生成和单页再生使用持久任务；明确区分等待凭据、结果待确认、取消和终态同步，查询不自动发送 Key。

## Colors

配色以矿物白、墨绿灰和单一海绿强调为骨架；具体值以前置 YAML 为准，与 CSS 的现有值一一对应。本文与源码是设计规范，本地工具生成的缓存不作为额外的颜色或交互约定。

### Primary

- **海绿（accent）**：主要按钮、链接、焦点、当前导航与选择状态；对应 `--accent`。
- **深海绿（accent-hover）**：主要按钮悬停；对应 `--accent-hover`。
- **浅海绿（accent-soft）**：品牌标记与移动工作区当前项；对应 `--accent-soft`。

### Neutral

- **矿物白（background）／纸白（surface）**：应用底色与编辑、输入、卡片表面；场景的纸面变量继承它们。
- **深墨（ink）**：标题、正文和关键控件文字；**灰绿（muted）**：说明、面包屑、元数据；**次级灰绿（tertiary）**：占位与不可用提示。
- **分隔灰（separator）／输入边框（field-border）**：分区、卡片与可编辑边界。结构依赖细线和底色区分。
- **浅中性（neutral-soft）／悬停中性（neutral-hover）**：工具背景、非主要操作悬停与局部提示区域。

### Semantic states

- **完成绿（success）**：设置凭证已填写等正向状态；不代表服务已经通过真实调用验证。
- **错误红（danger）**：删除、清除凭证和失败状态；错误提示同时使用文字。
- **待存赭色（warning）**：页面草稿和待保存提示，不用于宣告成功。

**The Action Color Rule.** 海绿用于操作、当前位置和选择，错误与待保存保留独立语义；不能只靠颜色表达状态。

## Typography

**Body Font:** 前置 tokens 中的系统中文无衬线栈；界面不下载外网字体。页面标题沿用这套字体，不另造展示字体系。

**Character:** 紧凑但可读的工具排版。标题用中等偏重字重和轻微收紧字距；解释性正文保留较松行高。层级由字号、字重与位置形成，避免把所有信息都做成标题。

### Hierarchy

- **Headline**：token 对应桌面工作台主标题；手机依视口收至（27px）和（25px）。设置标题实际使用（`clamp(26px, 4vw, 34px)`）；阅读器页标题使用（36px），窄屏收至（28px）。这些属于各表面级差，不是新增品牌字体。
- **Title**：token 对应普通分区标题。编辑器当前页标题为（25px），窄屏为（23px）；内容区块标题为（20px），窄屏为（18px）。
- **Body**：token 对应说明正文；结构化解释采用（14px／1.8），保留换行并允许长词折行，宽度上限（65ch）。阅读器页面说明上限（70ch）。
- **Label / Button**：token 对应字段与动作文字；辅助信息通常为（11–12px），仅用于元数据、保存与说明，不能替代主要内容。
- **Inputs**：通用字段文本（15px）；设置输入（16px）；内容检查器字段（14px）。字号随编辑密度变化。

**The Readable Content Rule.** 解释保留为可选择、可换行的 DOM 文字；插图中的示意标记不能取代页面正文。

## Layout

### 工作台与编辑器

工作台居中容器上限（1280px），桌面内边距（44px 40px 20px）。第一工作区为两列（`.93fr / 1.07fr`）及（32px）间距：左侧输入、右侧示例；作品库随后。作品卡片采用自适应网格，最小列宽（220px），卡片缩略图允许裁切，作品画布不沿用该裁切规则。

编辑器占满（100dvh），顶部工具栏与内容区分离；桌面主区为（228px / minmax(0,1fr) / 310px）的目录、画布、检查器。目录和检查器各自滚动，主画布保持最小宽度约束；当前页标题、保存状态、内容表面、继续探索按任务顺序排布。内容检查器中的保存按钮置于字段上方并使用 sticky 定位。

设置页采用上限（780px）的单列容器，以内容理解、图片生成、密钥与隐私分组，用分隔线而非叠加卡片组织长表单。阅读器主区上限（1120px），顺序为路径、页标题、说明、作品与继续探索。

### 响应行为

| 断点 | 实际行为 |
|---|---|
| ≤1190px | 编辑器目录/检查器缩为 195px/280px，顶部项目名隐藏。 |
| ≤1000px | 默认保留画布与 300px 检查器；目录由「页面」工作区切换，底部出现编辑工具导航。 |
| ≤760px | 首页两列改为单列；编辑器一次显示画布、页面、分支/热点或内容之一，底部四项切换，避免压缩三列。检查器保留当前页和保存状态，保存按钮紧随其后固定。作品库变为两列。 |
| ≤680px | 结构化 atlas 改单列；阅读器标题、页头、探索按钮改为窄屏布局。 |
| ≤560px | 设置操作区纵向排列，按钮共享可用宽度，选项触控高度增大。 |
| ≤420px | 首页进一步收紧左右留白、标题与动作；编辑页部分导航保留图标并依赖可访问名称。 |

### 图片与结构化内容

图片场景加载后使用 `naturalWidth / naturalHeight` 确定画框比例，图像完整包含（`object-fit: contain`），热点以该画框内的归一化图像坐标定位。热点数据保存矩形的左上角和尺寸；可见圆点画在矩形中心，拖动/键盘移动把矩形约束在（0–1）范围。宽屏、竖图与留白不另建坐标系。

结构化 `SceneDocument` 目前为 version 1：`atlas` 在宽屏双列呈现区块，`sequence` 纵向呈现带步骤号的区块；有图时先显示插图。标题、说明、区块小标题和解释可编辑，区块可关联热点/分支。它不是自由排版画布；新页面沿用已实现的两种结构。

新AI主题页、子页和符合条件的旧页再生产出结构化正文；插图是明确可选项，文字模型可以独立完成知识页。`kind=section`仅表达分支关系，位置、尺寸与评分均为空，不在插图上显示编号或校正工具。上传图片保持`kind=image`与自然图像坐标。

**The Shared Coordinates Rule.** 编辑画布、只读预览与离线播放器复用 `SceneRenderer`；不得为了不同视口分别换算或硬编码热点位置。

## Elevation & Depth

工作台与内容表面默认扁平，以纸白、浅中性底色和细边框体现分区。项目菜单与确认对话框用浮层阴影表明遮挡关系；图片热点的圆点使用小阴影保证覆盖在不同图像上仍可辨认，结构化区块选中使用内描边。现有 `--shadow-card` 没有形成常规卡片的实际用法，不作为卡片规范。

### Shadow Vocabulary

- **项目菜单**：（`0 10px 30px rgb(32 48 43 / 14%)`），用于导出与分享浮层。
- **确认框**：（`0 24px 60px rgba(0,0,0,0.25)`），与半透明遮罩共同表示模态层。
- **热点圆点**：（`0 2px 7px #152b354d`），只用于作品图片上的标记。
- **区块选中**：（`inset 0 0 0 2px var(--scene-accent)`），表达当前选择，不表达悬浮。

**The Flat Tools Rule.** 普通工具和卡片不增加悬浮阴影；深度仅传达浮层、图片标记辨认与选择。

## Shapes

控件采用 `control` 圆角，卡片与画布外框采用 `surface` 圆角；紧凑标签/导航采用 `compact`，图标按钮与小提示采用 `utility`。圆形仅承担编号、热点和步骤序号。当前阅读器的分隔网格、按钮与内容版面保留方正边缘，与外层工作台圆角容器共存，不强制所有面板圆角化。

边框以细线（1px）为主；主要按钮使用同色边框。分段选择、检查器 tabs 以底部（2px）强调线表示当前项。图片画布的边界与图像框明确分离，保持图像坐标一致。

## Components

### Buttons

主要按钮有明确的海绿实底，次要按钮为纸白与细边框，文字操作使用海绿链接式外观。普通按钮最小高度（42px），紧凑按钮（36px），设置主/次按钮（44px）；图标按钮为（36px）见方。主按钮悬停使用更深强调色，次按钮使用浅中性表面，禁用状态通常降低不透明度；固定保存按钮使用不透明中性底色和文字，避免滚动内容穿透。

通用状态变化为颜色/边框的（150ms）过渡；焦点使用海绿实线（2px）及外偏移（3px），设置字段为（2px）偏移。保留原生按钮与链接语义。危险动作使用红色语义和明确文案；删除作品经过确认框，取消先获焦点，支持 Escape、焦点约束和关闭后恢复焦点。

### Inputs / Fields

标签与字段垂直排列，提示位于字段之后；输入为纸白、细边框、适度圆角，textarea 可纵向调整。内容检查器在紧凑空间使用更小内边距。设置的 API Key 为密码输入；URL 与模型可直接修改，服务商/模型预设只作为填值帮助。

### Chips / Tags

设置预设是可按下的选项按钮，以边框、浅强调背景和 `aria-pressed` 共同表达选择；状态标签是文案，不伪装成按钮。「已填写」与真实测试结果分开呈现。草稿状态使用文字与赭色；失败通知使用明确错误信息与可执行恢复动作。

### Cards / Containers

创建表面、项目卡片、编辑画布使用白底与细边框，卡片内常用（16–26px）留白。项目卡片的打开入口覆盖主要内容；删除按钮悬停或内部聚焦时显示，触控设备始终可见。空作品库使用虚线边界和说明，不虚构占位作品。

### Navigation

顶部工具栏区分品牌、当前作品与全局动作；面包屑说明当前层级。页面目录以缩进、竖向分隔线和浅强调选中行呈现树结构。热点与内容检查器以及移动工作区使用真实按钮和 `aria-pressed`；阅读器路径使用 `aria-current`。导出菜单打开后聚焦菜单项，方向键切换，Escape 关闭并恢复触发按钮焦点。

### Scene / Hotspots

图片热点的可操作区域为（44px）方形，可见编号圆点为（28px）。有链接的阅读热点使用海绿；无子页热点保持禁用，并通过可访问名称说明。标签在悬停、键盘焦点或选中时显示。

编辑热点先选择、后拖动；点击选择不进入分支。拖动超过（5px）才开始预览，结束时提交一次；取消指针操作或 Escape 放弃预览。方向键每次移动图像归一化距离（0.005），Shift 改为（0.02），按键松开或失焦提交。结构化区块直接选择并在检查器修改文字，打开分支使用单独入口。

结构化区块被选择后，检查器滚动到对应区块并聚焦小标题，选区标记同时显示；正常输入不重新抢焦点。本地分支面板以「添加子页／打开分支」为直接动作，不显示AI选择框；服务端只有尚无子页的热点可勾选生成。本地未改稿区块也可直接添加子页，显示、保存与阅读沿用同一稳定身份，旧连接不因编辑丢失。

### References / Creation notes

页面级`content_metadata`独立于正文版式，旧图片页也能补资料。内容面板在区块表单之后显示只读生成说明、作者资料和人工核对选项，共用现有草稿与保存；不增加页签或弹窗。资料包含标题、可选HTTP(S)链接与说明，无效地址在字段旁提示且阻止保存。正文、资料或热点文字变化使原核对声明失效；选中状态、坐标调整和同名重复写入不改变它。

共享阅读器在正文之后显示「参考资料与生成说明」，分别说明AI输入类型/模型、作者核对声明和参考资料。无资料准确写「本页未附参考资料」，旧页不补造AI出处。资料由作者填写，系统未抓取、核实或验证逐条支持；不把模型名称当资料来源，不采纳模型伪造的URL或已核实声明。外链使用`noopener noreferrer`，中英文同义，手机长标题、地址和说明自然换行。

### Drafts / Save / Local work

- 创建草稿的主题、关键词与输入方式保存在当前浏览器；图片 `File` 只存内存，刷新后需重新选择。进入设置再返回不会主动清空输入。
- 示例始终标记为示例，先以只读作品体验；创建副本后作为本地作品编辑。手动知识页和手动图片标注不依赖 Key；本地作品可修改内容、添加分支、预览和导出。
- 页面内容按作品/页面保存独立浏览器草稿。界面区分「未保存」「有页面草稿待保存」「保存中」「保存失败」与「已保存在此浏览器」。显式保存成功后清除对应草稿；有任意页面草稿时，预览/导出入口要求先保存，避免把旧内容当作新内容发布。
- 服务端保存失败会保留本地恢复副本，并给出重试或导出途径。浏览器存储空间不足时界面明确说明改动只保留在当前页并提示导出；不能把本地存储等同于可靠备份。
- 根页分析、子页生成和单页再生使用服务器持久任务；刷新、进入设置或切换作品只结束本地订阅。首次核对、任务进行中与终态同步期间暂锁整份服务器作品；单页再生完成前保留原页面。手机画布提供「查看生成任务」入口，长状态面板可滚动。
- 任务缺少临时凭据时，显示原服务模型与明确的「使用当前设置恢复」动作，配置不匹配时禁用；查询/订阅不自动提供 Key。远端结果未知时停止自动调用，可保留允许接受的阶段成果，或经单独的计费确认重新调用；无可恢复结果的异常只提供取消，不因资产丢失而解除未知调用保护。
- 没有活动任务或待核对操作时，读取最近一次任务，保留失败或部分完成的解释。只有无警告的成功任务收起详情；异常和收费决定始终可见。手机画布对终态异常显示「查看生成提示」，已保存文字可以继续编辑，不把缺图当作全部失败。

### Settings / Credentials / Publication

模型设置为独立的表单草稿；测试使用当前填写内容，不自动保存。更换对应服务地址会清空该组凭证，内容理解与图片服务各自独立。默认 Key 仅在当前页面内存中，用户勾选「在此浏览器记住密钥」并保存后才进入浏览器持久存储；清除操作同时清掉已保存和当前输入的凭证。服务地址和模型选择可保留。

设置页面明确说明：生成/测试时，Key 经自托管后端转发给所选服务；普通页面不发送 Key。测试可能产生供应商费用，设置状态不能冒充已经实测模型可用。只读实例链接需要原实例在线；共享浏览状态独立于作者工作台。离线 ZIP 与 JSON 从允许的作品字段导出，不包含 Key、连接配置或页面草稿；离线播放器沿用相同的 DOM 内容和坐标规则。

### Accessibility / Current limits

已实现的机制包括可见键盘焦点、字段标签、图标入口名称、热点方向键操作、确认框焦点约束、进度/保存状态以及错误通知语义；阅读器切页后聚焦新标题。布局允许长文本换行，内容解释不烘焙进位图。`prefers-reduced-motion` 关闭或大幅缩短过渡、转动与骨架动画。

这些是实现事实，不等于完整无障碍认证。部分工具按钮保持（36–42px）高度；密集辅助信息仍有较小字号，不能据此推导所有控件达到同一触控标准。知识页已有作者参考资料编辑，但没有自动来源检索/事实核验，也没有自由排版、多人协作或账号隔离。前三轮涵盖持久恢复，第四轮补齐就地编辑，第五轮接入AI正文与来源并检查中英文390px布局，见 `docs/ROUND_5_IMPLEMENTATION.md`。真实付费模型知识质量、跨浏览器与真实读屏未实测。实际ZIP播放器经HTTP启动/导航验收，development和production构建由JSDOM检查；浏览器file://双击打开仍未验证。

## Do's and Don'ts

### Do:

- **Do** 以实际作品、当前页和下一步动作建立信息层级，新增工具沿用海绿、纸白、墨色与细边框。
- **Do** 复用 `SceneRenderer` 与自然图像坐标，让作者修改、读者浏览和离线内容保持一致。
- **Do** 同时写明状态和恢复动作；本地、示例、草稿与服务端保存使用准确文案。
- **Do** 给图标操作提供可访问名称、保留焦点可见，并支持减少动态偏好。
- **Do** 先保存页面草稿，再让预览/导出反映已提交的作品。

### Don't:

- **Don't** 为普通工具卡片新增装饰渐变、弹跳热点或悬浮阴影，干扰内容判断。
- **Don't** 用裁切缩略图的布局规则定位作品热点，或把 DOM 解释文字改成图片。
- **Don't** 把已填写凭证当作连接测试成功，把示例当作真实 AI 输出，或把浏览器保存说成云端同步。
- **Don't** 将三种已验证任务的恢复扩大为多实例或跨版本升级保证，也不要把真实模型质量和账号隔离写成已验证能力。
- **Don't** 为所有页面复制某张截图的具体构图；复用视觉与交互规则，并按任务选择布局。
