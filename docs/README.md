# 文档导航

Flipbook Builder 是免账号、用户自备 API Key 的视觉知识工作台，面向个人或受信任环境中的单共享自托管实例。当前支持可编辑知识页与原图热点、中文/英文 Wikipedia 来源检索和区块引用、离线 ZIP 与独立只读固定版本发布。手动创作和引用不需要模型，在线检索仅需要后端与网络。

## 使用和开发

| 文档 | 内容 |
|---|---|
| [快速开始](../README.md) / [English](../README.en.md) | 无模型体验、Docker 部署、阅读和导出 |
| [产品定义](../PRODUCT.md) | 用户、流程、范围与产品约束 |
| [当前架构](ARCHITECTURE.md) | 模块、数据流、持久任务、页面历史、来源与发布边界 |
| [设计系统](../DESIGN.md) | 组件、视觉规则和交互约束 |
| [前端开发](../frontend/README.md) | 本地运行、共享渲染器和浏览器状态 |
| [后端开发](../backend/README.md) | 配置、API、数据边界和测试 |
| [验证说明](VERIFICATION.md) | 当前可运行命令、最近结果与未覆盖范围 |
| [模型质量评估](MODEL_QUALITY.md) | 固定中英文样例、三层生成、热点几何、逐项评审与运行对比 |
| [贡献说明](../CONTRIBUTING.md) / [安全说明](../SECURITY.md) | 提交要求、凭据和部署边界 |

## 当前实施与验收

第十一轮接通「来源检索 → 保存版本摘录 → 区块引用 → 保存 → 阅读与固定发布」，并整理首页、编辑器、设置和移动端导航；没有新增具体模型接入。正文、来源、引用和历史依赖共用保存边界，作者副本不冒充事实核验。

- [计划](ROUND_11_PLAN.md) / [实施报告](ROUND_11_IMPLEMENTATION.md)：方案、UX/UI、来源边界、浏览器闭环与未覆盖范围
- [验证说明](VERIFICATION.md) / [机器证据](evidence/round11-verification.json)：576 项后端、341 项前端、163 项及 27 个评估子项，以及真实进程、正式 Compose、实际浏览器与停库独立阅读
- 第十轮的模型无关修订、冻结保留集和未审质量状态保留在[原报告](archive/ROUND_10_IMPLEMENTATION.md)与[冻结记录](evidence/round10-candidate-freeze.json)；受控回放不代表真实质量提升。

来源只按作者操作向固定 Wikipedia API 检索，手填网址不抓取。保存的摘录可由作者校正，区块引用使用同页稳定身份；检索、摘录、摘要和关联都不代表事实已核验，也没有逐句自动归因。历史真实模型失败与早期产品验收从[历史索引](archive/README.md)查阅。

## 后续优先级

1. 导入作者材料，完善页码/段落等精确定位，并提示正文或摘录变化后可能失配的引用；支持关系仍由作者判断。
2. 跨浏览器 file:// 与真实辅助技术验收，以及发布大作品的容量/长期负载评估。
3. 具体模型选择后置；用户选定兼容服务与显式预算后再评估真实生成和独立 Agent/人工质量。冻结保留集不得用于继续调参或改写真值。

跨版本工作流迁移、多执行器调度和协作权限需要单独设计与验收。现有部署仍只支持一个后端 worker/副本。

## 历史记录

[历史索引](archive/README.md)保留最初的审查、研究与第一至十轮验收，评估工具的起点见[第八轮报告](archive/ROUND_8_IMPLEMENTATION.md)。它们记录当时的实现和测试数字，不能作为当前功能或可运行命令的说明。旧 SQLite PoC 与不适配知识页合约的 36 场景 CLI 已退役；当前进程验证入口是 `scripts/verify_knowledge_generation.py`、`scripts/verify_version_history.py`、`scripts/verify_publications.py` 和 `scripts/verify_source_citations.py`。
