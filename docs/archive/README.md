# 历史文档

以下记录形成于 2026-10-18 至 2026-10-19，保留当时的发现、方案和验收数字。它们不代表当前代码仍有相同问题，也不代表其中的旧命令仍可运行。当前说明见[文档导航](../README.md)、[架构](../ARCHITECTURE.md)和[验证入口](../VERIFICATION.md)。

| 阶段 | 计划与设计 | 实施与验收 |
|---|---|---|
| 初始审查与选型 | [项目审查](PROJECT_AUDIT.md)、[架构研究](ARCHITECTURE_RESEARCH.md)、[整体方案](OPTIMIZATION_PLAN.md) | [第一轮实施](IMPLEMENTATION_REPORT.md)、[首次浏览器验收](BROWSER_FLOW_VERIFICATION.md)、[DBOS PoC](DURABLE_JOBS_POC.md) |
| 第二轮：持久子页 | [计划](ROUND_2_PLAN.md)、[任务契约](DURABLE_INTEGRATION_PLAN.md) | [实施](ROUND_2_IMPLEMENTATION.md)、[独立审查](ROUND_2_CODE_REVIEW.md)、[17 场景记录](DURABLE_GENERATION_VERIFICATION.md)、[Postgres 基线](POSTGRES_STACK_VERIFICATION.md) |
| 第三轮：根页与再生 | [计划](ROUND_3_PLAN.md)、[持久设计](ROUND_3_DURABLE_DESIGN.md) | [实施](ROUND_3_IMPLEMENTATION.md)、[审查](ROUND_3_CODE_REVIEW.md)、[浏览器](ROUND_3_BROWSER_ACCEPTANCE.md)、[32＋1＋3 场景记录](DURABLE_PAGE_VERIFICATION.md) |
| 第四轮：编辑交互 | [计划](ROUND_4_PLAN.md) | [实施](ROUND_4_IMPLEMENTATION.md)、[审查](ROUND_4_CODE_REVIEW.md) |
| 第五轮：结构化 AI 正文与作者资料 | [计划](ROUND_5_PLAN.md) | [实施](ROUND_5_IMPLEMENTATION.md)、[审查](ROUND_5_CODE_REVIEW.md)、[浏览器验收](ROUND_5_BROWSER_ACCEPTANCE.md) |
| 第五轮后清理基线 | 退役旧 CLI、SQLite PoC 和无用 helper | [验证汇总](evidence/cleanup-verification.json)、[生成进程](evidence/cleanup-knowledge-process.json)、[整栈 HTTP](evidence/cleanup-postgres-stack.json) |
| 第六轮：页面历史与分支保护恢复 | [计划](ROUND_6_PLAN.md) | [实施与浏览器验收](ROUND_6_IMPLEMENTATION.md)、[验证汇总](evidence/round6-verification.json)、[历史进程](evidence/round6-history-process.json) |
| 第七轮：独立只读固定发布 | [计划](ROUND_7_PLAN.md) | [实施与浏览器验收](ROUND_7_IMPLEMENTATION.md)、[验证汇总](evidence/round7-verification.json)、[停库隔离](evidence/round7-isolation.json) |

[历史机器证据](evidence/)保留第一至第七轮及清理基线的原始结果，不改写历史测量值。第五轮原始后端测试为 257/257；随后删除废弃 helper 及其 8 个测试，清理基线为后端 249/249、前端 232/232。第六轮完整基线为后端 268/268、前端 262/262、历史进程 10/10、生成进程 7/7、整栈 HTTP 19/19 与双环境播放器通过。第七轮完整基线为后端 290/290、前端 299/299、发布与历史进程各 10/10、生成进程 7/7、整栈 HTTP 19/19 与独立 reader 停库隔离通过。当前结果统一见[验证说明](../VERIFICATION.md)。

JSON 中的旧入口、相对路径、临时文件名、地址和截图路径是当时的测量上下文，不是当前仓库文件清单；归档时不改写它们。第五轮两张有代表性的最终截图见[浏览器记录](ROUND_5_BROWSER_ACCEPTANCE.md)，第六轮历史恢复与第七轮固定发布截图见各轮实施记录。截图文件仍在 `docs/images/`。

SQLite PoC 和不适配新知识页默认合约的旧 36 场景 CLI 已退役，记录与关键证据保留，公共测试支持已归并到 `scripts/durable_acceptance/`。当前生成恢复检查使用 `scripts/verify_knowledge_generation.py`，页面历史检查使用 `scripts/verify_version_history.py`；不要复制历史命令执行。
