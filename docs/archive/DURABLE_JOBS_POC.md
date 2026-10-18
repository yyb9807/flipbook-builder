# DBOS 持久生成任务：本地验证报告

> 历史记录（2026-10-18）。本文保留当时状态；当前实现与可运行命令见[文档导航](../README.md)和[验证说明](../VERIFICATION.md)。旧 PoC / 36 场景 CLI 已退役。

日期：2026-10-18（Asia/Shanghai）。前置：[优化计划](OPTIMIZATION_PLAN.md)、[架构研究](ARCHITECTURE_RESEARCH.md)。

## 结论

**DBOS 核心库适合继续验证本项目的固定多步骤生成流程。** 本轮在真实独立 Python 子进程中执行两次 SIGKILL，重启后由 DBOS 恢复，已完成的步骤没有再次进入。默认临时 Key 的方式也能工作：重启后的未完成出图步骤停在 `waiting_credentials`，重新提供后继续。

这是隔离 PoC，未接入生产 FastAPI、项目数据库、真实模型服务或付费凭据。没有安装企业扩展、连接 Conductor 或注册云账号。当前产品的生成 API 仍不能据此声称已经具备持久恢复能力。

PoC 代码与独立依赖已退役；原始运行记录保留在[PoC 机器证据](evidence/durable-jobs-poc.json)。生产持久任务已在后续轮次接入，当前状态见[架构](../ARCHITECTURE.md)。

## 实际环境与复跑

- Python **3.14.6**，macOS / Darwin。
- 实际安装并锁定 **dbos==3.3.0**、pytest==9.1.1；完整依赖版本见 `requirements.lock`（历史文件已退役）。
- SQLite 文件：`dbos.sqlite` 是 DBOS 系统库；`app.sqlite` 是业务状态、事件、调用意图与发布投影；`remote.sqlite` 模拟远程服务，不参与工作流执行或恢复。
- 临时虚拟环境 `/tmp/flipbook-dbos-venv`；首次集成测试产物 `/tmp/flipbook-dbos-poc-results`。代码不引用生产后端依赖。

在仓库根目录运行：

历史执行入口已退役。原始结果和当时的环境记录保留在本文及机器证据中；当前复测请使用[验证说明](../VERIFICATION.md)。

一键脚本创建新的临时目录，打印产物路径并保留日志、数据库和证据 JSON。可传 `--artifacts /tmp/一个尚不存在的新目录`；已有目录会拒绝，避免误删内容。不要在实验中使用真实 Key。

本轮直接运行集成测试结果为 **5 passed in 15.52s**；随后实测一键 runner，同样 **5 passed in 14.60s**，产物位于 `/tmp/flipbook-dbos-poc-runner-verification`。各步骤使用独立执行记录计数，没有唯一约束把重复执行隐藏起来。出图的计数发生在查找已有业务结果之前，因此不会把应用自己的去重保护误认为 DBOS 检查点。

## 采用的当前 API

使用 `DBOS(config=...)`、`DBOS.launch()` / `DBOS.destroy()`、`@DBOS.workflow()`、`@DBOS.step(retries_allowed=False)`、`DBOS.start_workflow()`、`SetWorkflowID()`、`DBOS.get_workflow_status()` 和 `DBOS.cancel_workflow()`。设置固定 `application_version='poc-v1'` 与 `executor_id='local'`，不依赖旧版 FastAPI 构造参数。

官方文档说明检查点恢复、默认 SQLite 与生产 Postgres 建议；这与本实验环境一致。[DBOS 编程指南](https://docs.dbos.dev/python/programming-guide)

`SetWorkflowID` 默认复用已有任务；`cancel_workflow` 在步骤边界取消，并不能撤销已经完成的外部动作。本实验另外在长等待中设置应用取消检查点。[当前方法文档](https://docs.dbos.dev/python/reference/contexts)

## 流程与服务契约

```text
submit(operation_id, topic, raw_key)
  ├─ raw_key 只进入进程内 vault；不进入 DBOS 参数
  └─ DBOS workflow(operation_id, topic, credential_ref, scenario)
       → plan step → image step → commit step
```

三个假步骤分别输出结构化计划、假图片资产和发布记录。`worker.py` 通过 stdin/stdout JSON 行协议调用普通 Python 服务方法，便于真实进程控制；没有增加 HTTP 服务依赖。

| 方法 | 本次验证到的约定 |
|---|---|
| `submit` | 返回固定 job ID；同一操作 ID 和相同输入复用任务；变更输入拒绝 |
| `status` | 返回用户状态、DBOS 原始状态、实际步骤次数与模拟远程调用数 |
| `events(after_event_id)` | 按递增事件 ID 返回新增事件；可以由未来 SSE 适配 Last-Event-ID |
| `provide_credentials` | 新 Key 只写当前进程内 vault；唤醒等待中的出图步骤 |
| `cancel` | 持久记录取消意图，调用 DBOS 取消并唤醒本地等待 |

事件表是用户状态投影，不是第二套执行队列。它用唯一事件键抵御步骤重放产生的重复通知；事件 ID 允许有间隙。此处实测的是 Python 查询契约与游标补发，没有声称已验证浏览器 SSE、代理断连或网络背压。

## 五项测试与实际结果

| 场景 | 操作 | 实际结果 |
|---|---|---|
| 检查点恢复与临时 Key | 规划返回后 SIGKILL；无 Key 重启；重新提供 Key；出图返回后再 SIGKILL；再次重启 | plan / image / commit 各进入 **1 次**；远程调用 **1 次**、发布 **1 份**；第二阶段等待凭据，第三阶段直接完成本地提交 |
| 显式取消 | 无 Key 启动，进入 waiting_credentials 后取消，再重启 | 业务状态 cancelled，DBOS 状态 CANCELLED；远程调用 **0 次**，发布 **0 份** |
| 远程成功但无本地结果 | 模拟服务已写成功记录，但出图 step 返回前 SIGKILL | image 未完成步骤实际进入 **2 次**；重启停在 waiting_confirmation；重新提供 Key 也不自动调用；远程仍 **1 次**、发布 **0 份** |
| 操作 ID 幂等 | 运行中重复提交三次；改变同 ID 的输入；完成后再提交 | 相同输入复用一个任务；不同输入拒绝；最终远程 **1 次**、发布 **1 份** |
| 序列化负控 | 在内存中故意把随机假 Key 放入 DBOS 默认 serializer | 原始字符串搜索检不出 Base64 形式，解码扫描可以检出，证明扫描并非只验证表面文本 |

首个场景还验证了事件补发：获取游标后立即查询为空，恢复后取得 **4 条**新增事件，没有重复 ID。完整运行的数据库、日志和证据保存在对应临时目录。

## 凭据检查

随机假 Key 通过父进程管道传入 worker；不放命令行、环境变量、测试产物或数据库。`submit` 不是 DBOS 装饰函数，原始 Key 在进入 `start_workflow` 之前被换成引用。实际消费 Key 的代码位于出图 step 内部，返回值只含资产与 request ID。

每个集成场景结束后检查：

1. 日志、SQLite 主文件及可见 WAL/journal 原始字节。
2. 三个数据库的完整 SQL dump。
3. 所有 **19 张表**的每个字符串/字节字段；对合法 Base64 数据解码后再查假 Key，涵盖系统 `inputs` / `output` / `error` 等字段。
4. 负控确认默认 serializer 误存 Key 时检查确实失败。

完成流程的场景检查了 **5 个非空检查点输入/输出字段**；每个场景的字段数量记录在 evidence JSON。本轮没有发现随机假 Key。测试不反序列化 pickle 执行对象，只检查解码后的字节，因此不需要加载数据库中的对象。

默认序列化采用 pickle + Base64，**Base64 不提供加密或秘密隔离**。本轮能通过的原因是没有把 Key 放入被持久化的数据，不是 DBOS 自动过滤了秘密。[官方序列化说明](https://docs.dbos.dev/python/reference/contexts#custom-serialization)

这项检查覆盖本实验的受控请求与产物，不等同于完成真实供应商 SDK、异常响应、追踪系统和部署日志的秘密审计。

## 结果不确定窗口

DBOS 步骤记录与远程服务不属于同一事务。远程已成功、本地尚未保存结果的窗口始终存在。PoC 在调用前写下不含秘密的请求意图；重放看到未确认意图后，停在 `waiting_confirmation`，既不返回伪造的成功，也不静默再调用。

这是**应用层的保守保护**，不是 DBOS 的自动付费去重保证。它也会把“意图已写、尚未真正发出请求”这一窗口暂列为待确认，宁可要求核实，避免自动重复付费。

实验的 `remote.sqlite` 只用于测试断言，不被业务恢复代码读取。没有利用模拟远程账本的全知视角假装真实服务一定支持结果查询。下一步应根据实际供应商实现请求 ID 查询、幂等键或人工确认；当前 PoC 只提供待确认与取消，未实现核实后接受结果/明确重试的产品界面。

本地发布使用唯一操作 ID，可防止重复记录；这也不使业务数据库与 DBOS 检查点变成跨库原子事务。生产接入仍需版本约束与幂等提交。

## 接入前仍需处理的限制

- **凭据等待占用线程。** 本轮在未完成出图 step 内用进程条件变量等待，证明“不落秘密也可恢复”的契约。它不适合大量长时间暂停的任务。生产版需设计暂停容量、TTL、超时、密钥清理，以及重新提供凭据时的调度方式；不能把获取 Key 的 step 返回值持久化。
- **单实例约束。** 仅验证固定本地 executor 的自动启动恢复。多 worker、节点故障协调、滚动升级和任务代码版本迁移均未验证；不能同时启动多个相同 executor 抢同一数据库。
- **取消是协作式的。** 已经发送的模型请求可能继续完成并计费。本轮验证安全点和凭据等待取消，没有模拟无法中断的真实网络调用。
- **SQLite 是实验选择。** 业务项目继续用 Postgres；生产接入需改为 Postgres 实测并发、锁、事务边界和保留策略。
- **没有性能结论。** 15 秒左右是测试运行耗时，不是任务吞吐量、生产恢复 SLA 或模型速度。
- **没有生产任务 API。** 浏览器刷新后重连、凭据重新提交入口、待确认界面和多页生成部分成功，均须在下一阶段接入现有 UI/API 后验收。

当时建议保留 PoC 作为回归基线；本次整理已由正式 Postgres/API 进程验证替代独立实验代码。下一步先迁移一条生成流程，增加 Postgres 与真实接口契约测试，再决定是否全面采用 DBOS。当前证据支持继续采用它进行小范围集成；尚不足以直接替换全部生成路由。
