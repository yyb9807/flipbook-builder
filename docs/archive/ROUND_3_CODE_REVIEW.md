# 第三轮独立代码复核

> 历史记录（2026-10-18）。本文保留当时状态；当前实现与可运行命令见[文档导航](../README.md)和[验证说明](../VERIFICATION.md)。旧 PoC / 36 场景 CLI 已退役。

2026-10-18。审查对象是本轮根页分析和单页再生的持久任务扩展，以及它们接入现有任务界面的行为。审查期间未修改生产源文件，未启动工作进程或调用模型。

## 结论

发现 **1 项 P2，已由实施代理修复并通过独立复核**。除该项外，未确认其他 P1 / P2。浏览器和真实进程故障验收应以各自的最终报告为准。

### P2：资产丢失会跳过已有未知调用的收费确认

位置：`backend/jobs/page_workflows.py:70–79`（检查资产早于 `begin_attempt`）及后续 `run_page` 的失败收尾。

可复现时序：上传根页分析（定位阶段也同理）已经写入 `generation_attempts.state='started'` 并发送远端请求；进程在保存结果前中断，恢复前资产文件同时丢失或变动。恢复执行 `page_provider` 时，资产预检立即返回 `local_asset_unavailable / failed`，没有读取已有 attempt，因此后续 `finish_page_failure` 将任务置为 failed 并解除作品锁。上次远端请求仍可能已完成并计费，但界面只显示生成未完成及原内容保留，允许用户发起新任务。这弱于 `JobStore.fail` 对 started intent 保留 `waiting_confirmation` 的既有保护。

修复前独立执行了最小函数重现：给存储 gate 配置已有 unknown attempt，模拟同一恢复步骤资产缺失，实际返回 `{state: failed, error.code: local_asset_unavailable}`，且 `begin_attempt` 调用次数为 **0**。独立审查代理未修改生产代码；后端作者也确认该交叉时序成立。当时资产变动测试覆盖的是“分析成果已经确定保存、commit 前资产变化”，未覆盖此交叉故障。

建议先读取持久 attempt 状态；若同 stage 已有 started，保留未知结果确认及可能计费提示。没有未确认 attempt 时，再按本地资产错误明确失败。明确点击 retry 后因资产仍不可用而失败可以接受，但不能在首次恢复时把已有未知收费窗口静默变成普通失败。补充真实 PG 回归：started + missing/corrupt asset → waiting_confirmation、没有新增远端调用、取消后才允许新任务。

**修复复核**：`page_provider` 的资产错误分支现在调用 `JobStore.missing_asset_attempt`，在统一事务锁内检查同一 attempt。started 会保留为 `waiting_confirmation / recovery`，公开错误 `asset_recovery_required` 同时说明图片缺失与可能已计费，并禁用 retry / accept；用户核实后明确取消。无 attempt 才直接本地失败；completed 复用已知远端成果，最终 commit 仍核对资产。独立隔离执行这三个实际生产函数分支，分别得到 failed / unknown / completed，且未触发新的 attempt admission 或远端调用；三个断言均通过。实施代理另新增真实 PG 三分支回归并报告 **3/3 通过**。

**真实进程证据复核**：[round3-asset-unknown.json](evidence/round3-asset-unknown.json) 中根页分析、根页定位和再生定位三个“未知调用 + 资产缺失”SIGKILL 场景均为 passed（**3/3**）。每个未知阶段仅调用一次，新增自动调用为 0；恢复锁保留，retry / accept 被拒绝，只有明确取消才解除锁。再生场景保留原页面。该证据同时记录凭据审计：20 表、640 单元、29 个检查点、98 个 Base64 候选及 427 个原始 PG 关系文件（9,379,840 字节）扫描通过，序列化负控被检出；真实付费供应商调用为 0。本独立审查逐项核对了机器证据字段，未重新运行这些子进程场景。

## 核查结果

- **请求应答丢失与原文件身份**：`useGenerationJobs` 自动发现按原 operation 查询，包含终态任务，不依赖原 File 或当前模型设置。手动“用原操作重试提交”按钮要求当前设置与原配置一致；`submitGeneration` 本身先查询原 operation，未找到时再校验设置并提交，不能把自动发现的无设置要求泛化为手动按钮行为。未接收的图片仍要求相同原始 SHA256；后端将原始文件 hash 与规范化 PNG hash 分开，已接收的无 File 重放继续校验文字、关键词、供应商配置和出图意图。operation 冲突不会偷偷换输入。
- **取消、失败与原内容**：根页只在 commit 时创建稳定目标节点并设置 root；再生 admission 只改变运行状态，正文与图片到最终事务才替换。取消标志和终态检查与写入共用事务锁。再生已知出图失败不替换旧页；未知出图不提供“保留文字”入口。已有热点或结构化正文在前后端都受保护。
- **资产与收费边界**：上传在入队前完成解码与不可变保存，工作流只保存 URL/hash 引用。供应商调用前写持久 intent；完成结果先存 attempt 再形成 DBOS 检查点。未知结果需明确决定；发现的交叉故障已按上文修复。本地缺失资产不会自动重新出图，提交前还会再次核对图片资产。
- **锁顺序与升级**：新 admission、commit、取消、通知、页面/热点编辑和作品删除使用 project → node → job 顺序。项目锁串行检查不同 kind 的活动任务；未创建会因旧版本多个活跃任务而直接失败的项目级唯一索引。新工作流独立命名，未把根页/再生分支插入 children-v1 的步骤循环。
- **前端身份与草稿**：首次提交收到项目 ID 后先保存 pending，再打开空根页任务界面。终态只从服务端重新读取作品；应用结果前同时检查 workspace revision、origin 与 project ID。根页提交后原子选中首张页面，再生保持当前导航；节点草稿保存在独立 store，创建草稿仅由匹配的 operation 清除。
- **终态显示**：新任务 kind 使用根页/再生各自的结果标识判断是否已有提交成果，失败或取消不会无条件宣称页面已经替换。警告对应 partial 状态；未确认提交仍保留原操作，而不会显示为业务完成。
- **凭据边界**：工作流参数和冻结输入不包含 Request、UploadFile、File、Key 或 provider config 对象中的秘密字段。供应商异常转换为固定公开错误；成功输出在写 attempt 和返回步骤前对本任务两类 Key 统一脱敏。浏览器持久 pending 使用明确白名单，File 与默认临时 Key 留在内存。

## 复核方法与证据边界

逐项阅读 `ROUND_3_PLAN.md`、`ROUND_3_DURABLE_DESIGN.md`，以及 `backend/jobs/page_workflows.py`、`store.py`、`service.py`、`locking.py`、`credentials.py`、相关生产路由和迁移；同时审查前端提交、发现/重连、reconciliation、空根页路由、草稿和任务面板。

对照阅读 `test_durable_pages.py`、前端 `generationJobs` / `useGenerationJobs` / `useBuilderActions` 测试及真实进程验收场景，检查测试是否覆盖业务输入身份、稳定节点 ID、原内容保留、跨 kind 排他、no-File 重放与秘密回显。除上述不启动 DBOS 的函数重现外，未在独立复核进程中重复运行全套测试，避免与正在进行的故障验收争用运行时；测试通过数量及真实故障结果由实施和验收报告分别记录。
