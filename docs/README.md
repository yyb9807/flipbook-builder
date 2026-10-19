# 文档导航

Flipbook Builder 是免账号、用户自备 API Key 的视觉知识工作台，面向个人或受信任环境中的单共享自托管实例。当前支持可编辑知识页与原图热点、离线 ZIP 和独立只读固定版本发布。

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

第十轮完成模型无关的可选修订、独立冻结保留集及功能验收。默认 `legacy-v1`；`grounded-v2` / `focused-v3` 均需显式启用。六组受控回放执行与自动检查通过，Agent/人工仍未审、真实模型调用 0，不代表质量提升。

- [计划](ROUND_10_PLAN.md) / [实施报告](ROUND_10_IMPLEMENTATION.md)：冻结顺序、设计取舍与真实浏览器流程
- [验证说明](VERIFICATION.md)：434 项后端、163 项及 27 个评估 subtests、299 项前端、进程恢复与停库独立阅读结果
- [候选冻结记录](evidence/round10-candidate-freeze.json) / [验收汇总](evidence/round10-verification.json)

参考资料由作者填写，系统没有自动抓取、逐句引用或事实核验。历史真实模型失败与早期产品验收从[历史索引](archive/README.md)查阅。

## 后续优先级

1. 用户选择兼容服务后，显式设置预算，在冻结保留集上开展真实生成和独立 Agent/人工评审；证明正文、热点与跨页质量后再决定是否启用实验。保留集不得用于继续调参或改写真值。
2. 自动来源检索与逐句关联：先定义来源合约，再引入检索实现。
3. 跨浏览器与真实辅助技术验收，以及发布大作品的容量/长期负载评估。

跨版本工作流迁移、多执行器调度和协作权限需要单独设计与验收。现有部署仍只支持一个后端 worker/副本。

## 历史记录

[历史索引](archive/README.md)保留最初的审查、研究与第一至九轮验收，评估工具的起点见[第八轮报告](archive/ROUND_8_IMPLEMENTATION.md)。它们记录当时的实现和测试数字，不能作为当前功能或可运行命令的说明。旧 SQLite PoC 与不适配知识页合约的 36 场景 CLI 已退役；当前进程验证入口是 `scripts/verify_knowledge_generation.py`、`scripts/verify_version_history.py` 和 `scripts/verify_publications.py`。
