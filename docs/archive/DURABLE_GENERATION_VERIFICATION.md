# 第二轮持久子页生成：历史验收

> 历史记录（2026-10-18）。旧 17/36 场景 CLI 已退役；当前知识页合约与 7 场景入口见[验证说明](../VERIFICATION.md)。

## 历史范围：第二轮 17 场景与第三轮 36 场景

以下保留第二轮子页17场景的历史基线。第三轮曾扩展根页与单页再生至36场景，记录见[根页与再生进程验收](DURABLE_PAGE_VERIFICATION.md)和[第三轮报告](ROUND_3_IMPLEMENTATION.md)。旧 CLI 预期 image/localize 阶段；第五轮默认知识页跳过 localize，因此该入口已删除。公共 Harness 已归并到 `scripts/durable_acceptance/harness.py`，旧场景只保留当时证据。

2026-10-18 最终定版全套 **17 场景全部通过**。此前先完成10场景与15场景验证，独立审查修复后再完整复跑。验证入口为 `verify_durable_generation.py`（历史入口已退役），对正式 FastAPI app、Postgres、DBOS、真实 agents 及本地 HTTP 假供应商执行，不是独立 PoC 或假后端。机器结果在 [durable-generation-20261018.json](evidence/durable-generation-20261018.json)。

此报告对应 `/tmp/flipbook-durable-acceptance-final/` 的最终实测快照；后续执行器代码变更仍需重跑相应验证。

## 实测结果

| 场景 | 通过的具体断言 |
|---|---|
| 两次 SIGKILL | 第一个子页 plan checkpoint 后杀进程，重启 image 阶段缺 Key 等待；补 Key 后 image checkpoint 完成，再杀进程；重启 localize 阶段缺 Key 等待，补 Key 后两子页全部完成。远端 plan/image/localize 各2次，已完成阶段没有重调 |
| 浏览器断订阅 | 关闭真实 SSE 连接，任务仍活动；重连按事件ID回放，ID递增、无重复；`Last-Event-ID` 生效，负数/非法游标被拒绝 |
| 操作幂等与编辑边界 | 父页 generating 期间相同 operation ID 取回原任务，改稳定输入返回409；已结束重复取回原任务；父页编辑/项目删除在活动任务期间409 |
| image 结果未知 → retry | HTTP供应商接收请求后断开响应，任务暂停；查询/补 Key 不触发重试；明确 retry 后总调用2次，旧确认不会消费两次 |
| image 结果未知 → accept/cancel | accept保留文字页，不伪造图片；cancel不落子页；均没有第二次远端调用 |
| localize 结果未知 → accept | 保留已完成图片，热点为空，没有自动定位重试 |
| plan 结果未知 | 没有规划成果时accept返回409，明确retry后完成 |
| image HTTP503 | OpenAI SDK及应用均不自动重试；只1次调用后等待确认。供应商故意在错误体回显假Key，日志/持久化扫描仍干净 |
| 远端成功、本地结果未写 | 实际图片服务返回成功后，测试wrapper在 `providers.perform` 返回前暂停并SIGKILL；重启停 waiting_confirmation，自动重复调用0次；accept保留文字页 |
| 晚到结果与取消 | 图片服务阻塞响应期间显式取消，随后放回成功响应；任务保持cancelled，无子节点/链接；再重启仍cancelled |
| 部分失败 | 第一分支规划4xx，另一分支完成；终态partial，保留1成功子页与1失败热点 |
| 提交竞争与执行器竞争 | 同时4个相同operation提交只创建1任务；其他operation409；第二个Uvicorn在任何额外远端请求前因执行器锁拒启 |
| 业务提交后、步骤checkpoint前 | 子页/父热点链接已在PG提交，DBOS步骤尚未checkpoint时SIGKILL；重放后只有1个子页，额外远端调用0次 |
| 凭据通知消费后再崩溃 | durable receive已消费通知、下一次provider step尚未开始时SIGKILL；再次重启重新等Key，不把“已通知”当作“还持有Key”，补Key后完成 |
| 执行器锁失效 | 终止持有 advisory lock 的专用PG连接，旧Uvicorn退出且没有继续图片调用；新进程取锁恢复，缺Key等待后完成 |
| 提交事务回滚 | 在正式 `DBOSClient.enqueue_in_transaction` 写入后测试wrapper强制异常；业务job=0、DBOS孤儿workflow=0、父页状态未卡generating；正常重启后相同operation可以成功 |
| 执行器错误且有未确认 intent | DBOS ERROR 后继续保持父页锁与待确认状态；不能普通retry/accept或建立新job，不额外调用；用户显式cancel后新operation可完成 |
| 活动 SSE 下有界停机 | 客户端保持订阅，直接SIGTERM，约5秒执行完整lifespan清理并退出，不使用SIGKILL；同job重启后补Key完成，plan/image各1次 |

部分断言归并在一个场景内，验证器共计17个顶层场景。

## 凭据扫描

假Key由父进程内存随机生成，仅通过真实API的请求头提供；不出现在子进程参数或环境、测试文件、gate文件。普通验收不打印Key；浏览器demo模式为人工填写会单独打印仅供本地假服务的Key。

最终全套实测：

- 20个业务/DBOS表、5,535个单元格；184个inputs/output/error检查点单元格。
- 576个Base64解码候选；只解码字节，不反序列化/执行pickle。
- 429个本次独立数据库的原始关系文件，共9,773,056字节。
- 原始日志、生成资产、逻辑SQL行导出与真实 `pg_dump` SQL。
- 所有扫描均未发现假Key；Base64序列化负控成功检出，证明不是只做原文搜索。

不会扫描共享Postgres集群的全局WAL，以免读取其他项目数据；原始文件检查仅限本次随机数据库的relation目录。这证明测试路径没有持久化本次假Key，不等于对所有未来第三方SDK/供应商响应形式的无限保证。

## 历史验证器命令（旧生成合约）

旧命令已删除，仅保留当时的运行环境和结果；当前代码请使用[知识页验证入口](../VERIFICATION.md)。

依赖：Python3.13、`backend/requirements-dev.txt`，可连接Postgres16。测试role需 `CREATEDB`，原始relation扫描需能调用 `pg_ls_dir`/`pg_read_binary_file`（本机隔离Docker与CI Postgres使用测试superuser满足）。代码创建 `flipbook_acceptance_<random>` 新数据库，绝不清空传入DSN所指数据库；成功后删除自己创建的库，失败则保留便于排查。

历史执行入口已退役。原始结果和当时的环境记录保留在本文及机器证据中；当前复测请使用[验证说明](../VERIFICATION.md)。

`--artifacts` 必须指向新目录，防止覆盖旧证据。`--keep-database` 可以保留成功测试的独立数据库。可选 `--pg-container flipbook-verify-20261018-db-1` 增加真实pg_dump SQL验证；不提供此选项也会扫描逻辑行、DBOS序列化单元格及原始relation字节，不要求Docker CLI。

本机最终全套命令：

历史执行入口已退役。原始结果和当时的环境记录保留在本文及机器证据中；当前复测请使用[验证说明](../VERIFICATION.md)。

完整证据目录 `/tmp/flipbook-durable-acceptance-final/` 包含正式后端进程日志、测试gate标记、真实图片、SQL dump与evidence.json；控制台记录位于 `/tmp/flipbook-durable-acceptance-final-output.txt`。成功后该次独立数据库已经删除。

## 历史浏览器恢复 UI 验收模式（旧生成合约）

历史执行入口已退役。原始结果和当时的环境记录保留在本文及机器证据中；当前复测请使用[验证说明](../VERIFICATION.md)。

命令保留真实Uvicorn与本地HTTP假供应商，自动seed项目、在plan checkpoint后真实重启，停在waiting_credentials(image)。终端打印项目/job ID、仅本机provider URL、模型名和一次性假Key；在Vite工作台的服务端项目中填入这些自定义供应商字段，通过任务的显式凭据操作继续。Key不会写入测试产物文件。Ctrl-C结束进程并删除自己创建的demo数据库。

## 第二轮历史结果的边界

实测环境为 macOS ARM64 / Python3.13.15 / Postgres16.15 / DBOS3.3.0。工作流按冻结热点顺序执行，使用单执行器锁。没有调用真实付费模型，不覆盖多实例凭据路由、滚动升级、跨版本workflow迁移、长期TTL压力或真实供应商质量。持久恢复范围是“生成子页面”；上传根页分析与旧regenerate尚不具备同等恢复契约。

## 执行器错误的专项补验

15场景全量之后，先单独实测 [monitor故障场景](evidence/durable-monitor-20261018.json)，然后已纳入最终17场景全套再次通过：远端图片成功后，正式 `JobStore.complete_attempt(image)` 写成果之前，由测试wrapper强制非供应商异常，令DBOS工作流进入ERROR。monitor保持未完成intent与父页锁，将任务投影为 `waiting_confirmation / recovery`，禁止普通retry/accept及新job，不自动发送第二次图片请求。显式cancel后才能创建新operation；实测替代任务成功。

这个执行器内部错误兜底比普通远端unknown更保守：当前不支持从已经ERROR的DBOS步骤直接恢复，UI提示先核实供应商结果，再显式取消并重新建立任务，不能描述为可直接继续的普通API失败。最终17场景还覆盖活动SSE下SIGTERM：Uvicorn清理完成后可能重抛原信号，合法退出码为0或-SIGTERM；验收同时检查本次日志含完整shutdown和当前进程结束记录，并验证同任务可恢复。
