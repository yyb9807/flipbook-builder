# 模型质量评估

评估入口是 `scripts/evaluate_quality.py`，使用已安装 `backend/requirements-dev.txt` 的 Python 3.13。从仓库根目录运行，不启动数据库、编辑器或独立阅读服务。

第九轮已用本机 `Qwen3-VL-2B-Instruct-4bit` 完成真实基线与实验候选推理。两侧均完成 18 阶段，但各 6/6 案例未通过逐项 Agent 评审；候选还把预约码的 48 小时有效期错误地改为从提交时起算。实验候选没有获准默认启用。详见[第九轮实施报告](ROUND_9_IMPLEMENTATION.md)与[机器证据](evidence/round9-verification.json)。

生产服务器未设置或留空 `KNOWLEDGE_GENERATION_REVISION` 时，新任务继续使用原有 v1 行为；只有显式设置 `KNOWLEDGE_GENERATION_REVISION=grounded-v2`，新入队任务才采用实验提示词及扩展上下文。已保存任务按各自冻结的修订执行，缺少修订标记的旧任务保持原行为。当前评估 runner 主动测试 `grounded-v2`，不能把本手册命令重跑的候选成绩当作默认生产质量，也不能用当前实验代码冒充修改前基线；复现基线须使用报告所记录的源文件版本与摘要。

## 先跑离线基线

```sh
python scripts/evaluate_quality.py run --output evals/runs/baseline
python scripts/evaluate_quality.py run --output evals/runs/candidate
python scripts/evaluate_quality.py compare evals/runs/baseline evals/runs/candidate \
  --output evals/runs/comparison
```

默认使用固定受控响应，仍执行实际生成 Agent 的提示词、解析和规范化。6 个案例各沿根页→子页→孙页走一条预设分支，共 18 阶段；执行成功只证明流程可用，不是模型质量分。`run.json` 记录运行与输出，`assessment.json` 保存检查结果，`report.html` 是离线可读报告，`review-template.json` 留给评审填写。运行目录包含模型正文，默认被 Git 忽略；不要把真实运行的整个目录上传或作为公开发布内容。

固定输入在 [`evals/datasets/quality-v1`](../evals/datasets/quality-v1/)。水循环案例使用依据 USGS 一手资料编写的摘要，预约案例完全虚构，数字和未知项由案例定义；图片是原创几何图，中英案例共用同一场景，只有一个独立视觉样本。素材、参考依据、真值框和回放响应按内容摘要绑定。更改固定样例应升级数据集版本，不能用新内容覆盖旧基线后声称是同一评估。

## 如何读结果

| 层次 | 检查内容 | 不能据此推出 |
|---|---|---|
| 执行 | 是否完成实际解析、三层生成、保存与恢复 | 正文正确 |
| 自动检查 | 正文空缺、重复片段、区块/分支引用；图片标签匹配、IoU、精确率与召回率 | 热点主题有价值、无幻觉 |
| 人工评审 | 逐项事实与禁止结论；正文、热点语义、跨页推进/一致性、指令遵循 0–4 分 | 小样本代表所有模型能力 |
| Agent 评审 | 独立身份、全页覆盖、精确引文定位与相同四维判断 | 人工认可或自动事实核验 |

图片坐标是左上角加宽高，均归一化到 0–1；真值匹配一对一，初始 IoU 阈值为 0.5，是本合成案例的配置，不是普遍质量标准。归一化过滤或修改输出也要保留诊断，不能只展示过滤后的好结果。

原有 v1 行为中，知识页子页只得到选中父区块的完整正文，图片子页使用父页说明。实验 `grounded-v2` 使用有界公共构造器，区分原始用户文字、根页概览、祖先标题、父页概览、选中区块与已覆盖主题；图片生成的概览只算页面上下文。生产任务在入队时冻结输入，评估器使用同一构造器。运行记录保存上下文摘要，报告优先显示每步实际记录的 `parent_context` 与类型；旧运行没有此字段时才从父区块重建。

默认分支策略仍是 `strict-preferred-label`，仅规范化大小写和空白；找不到或同时匹配多个固定标签会阻断后续阶段。显式传入 `--branch-selection first-hotspot` 则沿实际输出的首个入口继续，不将样例标签或答案注入生产提示词。它固定探索程序，不能保证两次展开相同主题。第九轮两侧均用此策略，但实际路径不同，比较仍为 `comparable=false`。

每个案例只有一次输出和一条分支路径。当前流程没有自然照片集、全树展开、统计置信区间或自动事实核验。未审分数为空；不能把自动结构通过、回放通过或未完成评审称为模型达标。

## 填写评审

```sh
python scripts/evaluate_quality.py review-template evals/runs/baseline \
  --output evals/runs/baseline/my-review.json
# 按模板填写评审身份、事实/禁止结论判断、各维度分数、理由和输出证据
python scripts/evaluate_quality.py apply-review evals/runs/baseline \
  evals/runs/baseline/my-review.json
python scripts/evaluate_quality.py report evals/runs/baseline
```

先阅读报告中的来源依据和三层实际输出，再逐项判断事实是否支持、禁止结论是否出现，最后按量表填写维度分数。证据应定位到具体页/区块并摘录相关文字，不能只写“很好”或仅凭格式评分。模板绑定运行、数据集、量表与每个案例输出；漏项、摘要不匹配或输出改变时不能获得完整评审通过。四个维度均须至少 3/4 分，事实与禁止结论也须逐项通过；工具不计算平均总分来抵消低分或漏项。

`run`、`report` 与 `apply-review` 重建报告时保留已有 `review-template.json`。显式 `review-template` 命令会写入指定文件；请像示例一样选用新文件名，避免覆盖正在填写的评审。

`reviewer.kind=human` 表示运行者声明实际人工评审，工具不验证身份；`calibration` 仅用于受控样例校准和流程测试，不能代替真实模型人工验收。建议团队先独立评同一小批样本，讨论分歧并修订量表，再扩大真实评估。[方法参考](https://developers.openai.com/api/docs/guides/evaluation-best-practices)。

自主 Agent 评审使用独立身份与状态：

```sh
python scripts/evaluate_quality.py review-template evals/runs/live-candidate \
  --reviewer-kind agent --output evals/runs/live-candidate/agent-review.json
```

`reviewer` 必须填写 `kind=agent`、`name`、`model` 和 `version`。每例的 `inspected_node_ids` 必须覆盖全部实际生成页；各项证据使用 `evidence: [{"node_id":"实际页 ID","section_id":"可选区块 ID","quote":"实际原文"}]`。带区块 ID 时，摘录必须来自该区块正文；否则必须出现在该页实际文字中。根页必需事实的支持或反驳证据须引用根页，不能用子页补足。缺失或未出现的判断允许空摘录数组，但须声明检查全部非空实际页面并给出理由；未生成的部分可以保持未审，状态为 `partial`。

工具只验证摘录位置、原文字串、覆盖和摘要绑定，不验证 Agent 的语义判断正确。`agent_quality` 单独显示通过、失败、部分或无效；Agent 评审始终保留 `human_quality=not_reviewed`，不得填写为实际人工。第九轮真实结果是两侧 `agent_quality=failed`，人工质量仍未审。

## 显式运行真实供应商

真实调用需要支持文字与看图输入的内容模型。供应商地址、模型和凭据环境变量名都必须显式指定；不读取项目 `.env`、部署默认 Key 或浏览器配置。用终端的安全方式设置临时 `QUALITY_EVAL_KEY`，不要把真实值写进命令示例、脚本或 Git。

```sh
python scripts/evaluate_quality.py run --live \
  --base-url https://provider.example/v1 --model YOUR_MODEL \
  --api-key-env QUALITY_EVAL_KEY \
  --max-calls 18 --max-output-tokens 66400 --timeout-seconds 300 \
  --output evals/runs/live-candidate
```

以上是可替换的供应商示例，不是可直接访问的服务。18 次、66,400 个**预留输出 token**覆盖当前完整路径的最大请求配额；它们不是实际用量或金额上限，输入 token、看图和不同供应商计价仍需另行核对。`--timeout-seconds` 限制整次运行的累计执行时间，恢复会沿用已耗时；单次请求最多等待 120 秒，且受剩余额度约束。程序不重试、不调用图像生成，也不自动并行扩散分支。实际响应可能随机变化，模型 ID 也未必是不可变版本；记录具体供应商版本后才能解释差异。

```sh
python scripts/evaluate_quality.py run --live --api-key-env QUALITY_EVAL_KEY \
  --resume evals/runs/live-candidate
```

恢复复用已完成阶段，沿用原供应商、模型和预算，并校验配置、样例与代码绑定。live 恢复仍须显式传入 `--live` 与 `--api-key-env`；`--output` 和 `--resume` 不能同时使用。发出请求前先原子记录意图并预留额度；任一请求结果未知即停止后续案例，恢复也不会新增请求。已失败阶段同样不自动再次调用。确认供应商侧结果和开销后，如确需重跑，应显式创建新运行，不篡改检查点以绕过保护。

原始响应保存上限为 1 MB；沿用的生产 HTTP 适配器先读完整响应，这不是下载体积的硬限制。恢复增加输出后，用 `review-template --output NEWFILE.json` 新建绑定当前结果的模板，再填写评审；评估方法或样例改变则应新建运行，旧检查点不能继续恢复。

## 可选本地 MLX 运行器

[`scripts/serve_quality_model.py`](../scripts/serve_quality_model.py) 是本轮专用的本地 HTTP 传输封装，依赖单独的 Python 3.12.13 / macOS arm64 环境；冻结依赖见 [`evals/runtime/mlx-vlm-0.7.8-python3.12-macos-arm64.txt`](../evals/runtime/mlx-vlm-0.7.8-python3.12-macos-arm64.txt)。它不属于后端运行依赖，也不修改提示词或修复模型正文。

固定模型是 `mlx-community/Qwen3-VL-2B-Instruct-4bit`，权重 revision 为 `9c4f5209e57b31f4b9dfba735de3fb983739c9cc`，`model.safetensors` SHA-256 为 `4750d95a2162829e127a94e83ac350d498d02070aab216c4687da48804a06ffb`。先下载并核验该快照，在快照目录的父目录保存 `manifest.json`，记录 `model`、`revision` 及各文件的 `name`、`size`、`sha256`；启动器逐文件核对，不接受其他 revision 或远程 Python 模型代码。权重与运行日志保存在仓库外或忽略入库的运行目录。

```sh
python3.12 -m venv /tmp/flipbook-quality-mlx
/tmp/flipbook-quality-mlx/bin/pip install \
  -r evals/runtime/mlx-vlm-0.7.8-python3.12-macos-arm64.txt
/tmp/flipbook-quality-mlx/bin/python scripts/serve_quality_model.py \
  --model-path /ABSOLUTE/PATH/9c4f5209e57b31f4b9dfba735de3fb983739c9cc \
  --port 18084 --max-calls 42 --events evals/runs/local-runtime/events.jsonl
```

服务仅监听 `127.0.0.1`，通过 `/v1/chat/completions` 接收文字与图片，通过 `/round9/capabilities` 记录实际运行策略。固定 temperature=0、seed=0、关闭 thinking，单请求最多 4,000 个输出 token、一次只处理一个生成请求，同一 `--events` 文件跨重启累计最多接收 42 次生成；中断的已接收请求也占额度。禁止自动 compaction、prefix/vision 缓存及推理重试；请求超过 120 秒直接终止服务进程，不自动重启或重发。新建或替换事件文件会开始另一份计数，不能借此重置本轮额度；独立实验的日志与总账必须分别保留。

第九轮基线与完整候选各 18 次、每侧最多预留 66,400 个输出 token、累计 1,800 秒；能力探测和失败尝试另行记录。真实运行使用同一固定权重及运行参数，API 费用为 0，预留 token 不等于实际用量。启动本地服务不会自动开始评估，评估仍须显式指定 `--live`、loopback 地址、模型及凭据环境变量名。

## 对比与回归

只有相同样例、评估方法、预算策略、完整覆盖范围与实际分支路径才适合直接比较。报告的 `comparable` 表示生成结果可比；`review_scores_comparable` 还要求两侧均有完整有效评审，且评审者的 `kind/name/model/version` 一致。不同身份、不同评审模型、未审、部分或无效评审不能直接比较分数；仍可分别阅读各侧输出与判断。

报告同时展示供应商、模型与生产代码摘要；生产代码改变时，差异也包含实现变化，不能仅归因于模型。第九轮两侧评审身份一致，但实际分支路径不同，因此上述两项均为 false，不给整体分数差异或优胜模型。两侧各 6/6 案例失败及候选的有效期起算事件错误，已阻止实验默认启用。单次小样本差异不构成统计排名。

```sh
python -m pytest scripts/quality_eval/tests -q
ruff check backend scripts
```

本地测试使用离线回放和受控 HTTP 供应商，不配置真实密钥；仓库不配置 GitHub Actions CI/CD。与 Postgres/DBOS 恢复、页面历史、固定发布和浏览器产品流程的验证分别保留，详见[验证说明](VERIFICATION.md)。
