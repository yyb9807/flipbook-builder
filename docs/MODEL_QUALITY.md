# 模型质量评估

评估入口是 `scripts/evaluate_quality.py`，使用已安装 `backend/requirements-dev.txt` 的 Python 3.13。从仓库根目录运行，不启动数据库、编辑器或独立阅读服务。

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

图片坐标是左上角加宽高，均归一化到 0–1；真值匹配一对一，初始 IoU 阈值为 0.5，是本合成案例的配置，不是普遍质量标准。归一化过滤或修改输出也要保留诊断，不能只展示过滤后的好结果。

知识页子页只得到选中父区块的完整正文；图片子页使用父页说明。它们不会额外得到兄弟区块、完整祖先或根素材。报告保留实际选择与上下文摘要，帮助定位内容漂移。找不到固定分支将阻断后续阶段；不同实际路径不能当作同题质量对比。

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

## 对比与回归

只有相同样例、评估方法、预算策略、完整覆盖范围与实际分支路径才适合直接比较。报告同时展示供应商、模型与生产代码摘要；生产代码改变时，差异也包含实现变化，不能仅归因于模型。人工评审不足时只比较可验证指标，不选“最佳模型”。单次小样本差异不构成统计排名。

```sh
python -m pytest scripts/quality_eval/tests -q
ruff check backend scripts
```

本地测试使用离线回放和受控 HTTP 供应商，不配置真实密钥；仓库不配置 GitHub Actions CI/CD。与 Postgres/DBOS 恢复、页面历史、固定发布和浏览器产品流程的验证分别保留，详见[验证说明](VERIFICATION.md)。
