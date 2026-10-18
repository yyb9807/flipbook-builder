# 历史文档

以下记录均形成于 2026-10-18，保留当时的发现、方案和验收数字。它们不代表当前代码仍有相同问题，也不代表其中的旧命令仍可运行。当前说明见[文档导航](../README.md)、[架构](../ARCHITECTURE.md)和[验证入口](../VERIFICATION.md)。

| 阶段 | 计划与设计 | 实施与验收 |
|---|---|---|
| 初始审查与选型 | [项目审查](PROJECT_AUDIT.md)、[架构研究](ARCHITECTURE_RESEARCH.md)、[整体方案](OPTIMIZATION_PLAN.md) | [第一轮实施](IMPLEMENTATION_REPORT.md)、[首次浏览器验收](BROWSER_FLOW_VERIFICATION.md)、[DBOS PoC](DURABLE_JOBS_POC.md) |
| 第二轮：持久子页 | [计划](ROUND_2_PLAN.md)、[任务契约](DURABLE_INTEGRATION_PLAN.md) | [实施](ROUND_2_IMPLEMENTATION.md)、[独立审查](ROUND_2_CODE_REVIEW.md)、[17 场景记录](DURABLE_GENERATION_VERIFICATION.md)、[Postgres 基线](POSTGRES_STACK_VERIFICATION.md) |
| 第三轮：根页与再生 | [计划](ROUND_3_PLAN.md)、[持久设计](ROUND_3_DURABLE_DESIGN.md) | [实施](ROUND_3_IMPLEMENTATION.md)、[审查](ROUND_3_CODE_REVIEW.md)、[浏览器](ROUND_3_BROWSER_ACCEPTANCE.md)、[32＋1＋3 场景记录](DURABLE_PAGE_VERIFICATION.md) |
| 第四轮：编辑交互 | [计划](ROUND_4_PLAN.md) | [实施](ROUND_4_IMPLEMENTATION.md)、[审查](ROUND_4_CODE_REVIEW.md) |
| 第五轮：结构化 AI 正文与作者资料 | [计划](ROUND_5_PLAN.md) | [实施](../ROUND_5_IMPLEMENTATION.md)、[审查](../ROUND_5_CODE_REVIEW.md)、[浏览器验收](../ROUND_5_BROWSER_ACCEPTANCE.md) |

[历史机器证据](evidence/)保留旧结果；第五轮证据位于[当前证据目录](../evidence/)。JSON 中的旧入口、临时文件名、地址和截图路径是当时的测量上下文，不是当前仓库文件清单。为避免将本机缓存作为项目资源，提交只保留两张有代表性的最终截图，见[最新浏览器记录](../ROUND_5_BROWSER_ACCEPTANCE.md)。

SQLite PoC 和不适配新知识页默认合约的旧 36 场景 CLI 已退役，记录与关键证据保留，公共测试支持已归并到 `scripts/durable_acceptance/`。当前正式恢复检查请使用 `scripts/verify_knowledge_generation.py`；不要复制历史命令执行。
