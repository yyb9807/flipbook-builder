# 模型质量评估

评估入口是 `scripts/evaluate_quality.py`，使用已安装 `backend/requirements-dev.txt` 的 Python 3.13。从仓库根目录运行，不启动数据库、编辑器或独立阅读服务。工具面向用户自选兼容供应商，不预置或按名称推断具体模型能力。

第十轮引入独立保留集与显式生成修订，六组受控回放执行/自动检查通过，但 **Agent 和人工质量均为 `not_reviewed`，真实模型调用 0**。当前结果统一见[验证说明](VERIFICATION.md)，设计与冻结经过见[实施报告](archive/ROUND_10_IMPLEMENTATION.md)；[第九轮报告](archive/ROUND_9_IMPLEMENTATION.md)保留历史真实失败。

## 生成修订与默认行为

| 配置 | 当前约定 |
|---|---|
| `--generation-revision legacy-v1` | CLI 新运行默认值，对齐默认生产生成行为 |
| `--generation-revision grounded-v2` | 显式实验，有界原始素材与分支上下文 |
| `--generation-revision focused-v3` | 显式实验，强调语言、素材中的数值/起算点/例外/未知项与跨页推进；图片采用明确 bbox 协议 |
| `--max-image-hotspots N` | 显式保留 1–12 个图片热点，默认 3；第十轮六组回放均明确传 5 |

生产服务器未设置或留空 `KNOWLEDGE_GENERATION_REVISION` 时，继续原行为；仅显式设为 `grounded-v2` 或 `focused-v3` 才启用对应实验。服务环境不接受用 `legacy-v1` 作为启用值，恢复默认应移除或留空该变量。Compose 默认不传实验变量。已保存任务使用入队时冻结的修订、来源和上下文；恢复不重新读取后来的页面或环境。旧无修订标记任务保持原路径与步骤顺序。

CLI 与服务端设置互相独立。评估修订、热点上限、供应商、预算、素材、生产源码和评估器摘要都进入运行/恢复身份；更改后在调用或检查点写入前拒绝恢复。图片热点上限也进入 policy 和项目设置，不按真值框数量自动推导，不后验修框。

## 离线基线与候选

```sh
# 两侧显式使用相同上限，避免混淆修订与保留数量的影响
# CLI 不传此参数时默认为 3；第十轮回放明确使用 5
python scripts/evaluate_quality.py run --max-image-hotspots 5 \
  --output evals/runs/baseline

# 显式候选
python scripts/evaluate_quality.py run --generation-revision focused-v3 \
  --max-image-hotspots 5 --output evals/runs/candidate
python scripts/evaluate_quality.py compare evals/runs/baseline evals/runs/candidate \
  --output evals/runs/comparison
```

回放使用作者录制的固定受控响应，执行实际生成 Agent 的提示词、解析与规范化。6 个案例各沿根页→子页→孙页走一条预设分支，共 18 阶段。`run.json` 保存运行输出，`assessment.json` 保存检查，`report.html` 是离线报告，`review-template.json` 留给评审。运行目录包含模型正文，默认被 Git 忽略，不直接公开整个运行目录。

开发集为 [`quality-v1`](../evals/datasets/quality-v1/)，其原有六案、输入、来源、真值与回放字节保持不变。独立保留集为 [`quality-holdout-v1`](../evals/datasets/quality-holdout-v1/)，含两个全新文字题材与一幅原创多尺度场景，各中英文，共六案、十八阶段。每套只有一个独立视觉样本，不能当作广泛图片集。

保留集由独立策划者只依据数据合约建立并先行冻结，实现侧在候选冻结前没有查看具体素材、事实、图片或坐标。候选冻结后才打开保留集进行验证，不用保留集调提示词、适配器或修订规则；不改动保留集。摘要、时间与边界见[冻结记录](evidence/round10-candidate-freeze.json)。如需新题材或新优化，应新建版本，不能覆盖旧基线后称为同一评估。

```sh
python scripts/evaluate_quality.py run \
  --suite evals/datasets/quality-holdout-v1 \
  --generation-revision focused-v3 --max-image-hotspots 5 \
  --output evals/runs/holdout-candidate
```

回放恢复、报告、评审与对比都需传入相同的 `--suite`；省略时使用开发集。每次新实验使用新的输出目录。

## 图片坐标与受控录制适配

旧修订继续接收 0–1 的左上角加宽高。`focused-v3` 明确要求 `bbox_2d=[left,top,right,bottom]`，均为 0–1000 相对坐标，验证后再转换为产品现有的 0–1 左上角加宽高。混入 `x/y/width/height`、倒置、越界、非有限或非法框会被拒绝，不猜尺度、不截到真值、不补第二次请求；小数仍按 0–1000 解释。

`focused-v3` 离线回放会将作者录制的旧 xywh 响应等价编码为该 bbox 协议；只适配图片根页录制，规则在查看保留集前冻结。它不读取真值或事实答案，不修改原录制，记录 `recording_adapter`、`original_recording_response_sha256` 和 `recording_response_sha256`。**live 响应不做这项适配或输出修复。** 原始响应、归一化结果和诊断分别保存。

## 如何读结果

| 层次 | 检查内容 | 不能据此推出 |
|---|---|---|
| 执行 | 实际解析、三层生成、保存与恢复 | 正文正确 |
| 自动检查 | 空缺、重复、区块/分支引用；标签匹配、IoU、精确率与召回率 | 热点语义有价值、没有幻觉 |
| 人工评审 | 逐项事实和禁止结论；正文、热点语义、跨页推进/一致性、指令遵循四维 0–4 分 | 小样本代表所有模型 |
| Agent 评审 | 独立身份、全页覆盖、精确引文定位与同样四维判断 | 人工认可或自动事实核验 |

真值按归一化框一对一匹配，初始 IoU 阈值 0.5 是合成案例配置，不是普遍标准。`grounded-v2` / `focused-v3` 区分原始用户文字、根页/父页概览、祖先标题、选中正文与已覆盖主题，模型概览不冒充原始证据。报告优先显示实际保存的 `parent_context` 与类型，旧运行缺该字段时才从父区块重建。

默认 `strict-preferred-label` 仅规范化大小写/空白，固定标签缺失或多匹配会阻断后续阶段。显式 `--branch-selection first-hotspot` 沿实际首个入口继续，不向提示词注入样例答案，但不能保证两次展开相同主题。分支路径不同必须标记不可直接比较，不给整体分差或优胜模型。

每例只有一次输出和一条分支。未审分数为空；自动结构、回放或未完成评审均不等于模型达标。

## 填写评审

```sh
python scripts/evaluate_quality.py review-template evals/runs/baseline \
  --output evals/runs/baseline/my-review.json
# 按模板填写身份、逐项事实/禁止结论、维度分数、理由和实际输出证据
python scripts/evaluate_quality.py apply-review evals/runs/baseline \
  evals/runs/baseline/my-review.json
python scripts/evaluate_quality.py report evals/runs/baseline
```

先阅读来源和三层输出，再逐项判断。模板绑定运行、数据集、量表和每例输出；漏项、摘要不匹配或输出改变不能通过。四维均须至少 3/4，事实和禁止结论也须逐项通过，不用平均分抵消低分。`run`、`report`、`apply-review` 保留已有模板；显式 `review-template` 请写新文件名，避免覆盖正在填写的评审。

`reviewer.kind=human` 由运行者声明实际人工评审，工具不验证身份；`calibration` 只用于受控校准，不能代替模型验收。Agent 使用独立状态：

```sh
python scripts/evaluate_quality.py review-template evals/runs/candidate \
  --reviewer-kind agent --output evals/runs/candidate/agent-review.json
```

Agent 必填 `kind/name/model/version`，每例 `inspected_node_ids` 覆盖全部实际页；`evidence` 使用实际 `node_id`、可选 `section_id` 与原文 `quote`。带区块 ID 的引文须出自该正文，否则须出现在该页文字中；根页事实证据只能引用根页。缺失结论可空引文，但须声明已检查全部非空页面并解释；未生成部分保留未审，状态为 `partial`。

工具验证引文位置、字串、覆盖和摘要，不能验证语义判断正确。`agent_quality` 与 `human_quality` 分开；Agent 不冒充人工。第十轮六组回放两者均未审，不沿用第九轮的失败评审到新运行，也不将受控校准转为真实通过。

## 显式运行自选供应商

真实调用需要支持相应文字/看图输入的内容模型。供应商地址、模型、凭据环境变量名和调用/token/时间额度均须显式指定；不读取 `.env`、部署 Key 或浏览器配置。安全设置临时 `QUALITY_EVAL_KEY`，不要把真实值写进命令、脚本或 Git。

```sh
python scripts/evaluate_quality.py run --live \
  --base-url https://provider.example/v1 --model YOUR_MODEL \
  --api-key-env QUALITY_EVAL_KEY --generation-revision focused-v3 \
  --max-image-hotspots 5 --max-calls 18 --max-output-tokens 66400 \
  --timeout-seconds 300 --output evals/runs/live-candidate
```

这是可替换占位示例，不绑定具体模型或可访问的服务。18 次与 66,400 个预留输出 token 是完整路径请求上限，不是实际用量或金额上限；输入 token、看图与供应商计价另算。运行累计执行时间由 `--timeout-seconds` 限制，恢复沿用已耗时；单次最多等待 120 秒并受剩余额度约束。不自动重试、不生图、不并行扩散分支。模型 ID 可能不是不可变版本，需记录实际版本。

```sh
python scripts/evaluate_quality.py run --live --api-key-env QUALITY_EVAL_KEY \
  --resume evals/runs/live-candidate
```

恢复保留冻结配置并验证身份，仍须显式 `--live` 与凭据环境名；`--output` 和 `--resume` 不能同用。调用前原子记录意图、预留配额；未知结果停止后续案例，恢复不新增请求。失败也不自动重调；确需再试应核对供应商与开销后新建运行，不篡改检查点。响应保存最多 1 MB，但 HTTP 适配器先读完整响应，这不是下载硬限额。恢复增加输出后须新建绑定当前输出的评审模板。

## 对比与回归

只有素材、评估方法、预算策略、覆盖和实际路径一致才适合直接比较。`comparable` 表示输出可比，`review_scores_comparable` 另需两侧完整有效评审且 `kind/name/model/version` 一致。生产源码与评估器摘要均记录；实现改变时不能把差异只归因于模型。语义评审未完成或分支不同，不给整体质量优胜结论。

```sh
python -m pytest scripts/quality_eval/tests -q
ruff check backend scripts
```

测试使用离线与受控 HTTP，不配置真实模型。仓库不配置 GitHub Actions CI/CD。当前测试数字及产品持久任务、历史、发布和浏览器功能验收统一见[验证说明](VERIFICATION.md)，不能替代真实模型质量评审。
