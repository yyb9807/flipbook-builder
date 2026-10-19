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

第九轮用本地 Qwen3-VL 2B 量化模型完成原行为与候选各 18 次真实生成，并完成产品浏览器全流程。两侧各 6/6 案例未通过逐项 Agent 评审，人工仍未审；候选没有默认启用。2026-10-19 的结果、复测命令与边界见[验证说明](VERIFICATION.md)，不能把功能验收通过当作内容质量达标。

- [第九轮计划](ROUND_9_PLAN.md) / [实施报告](ROUND_9_IMPLEMENTATION.md)：真实模型基线、失败证据与实验默认关闭的决定
- [桌面质量报告](images/round9-desktop-quality.jpg) / [移动只读阅读](images/round9-mobile-reader.jpg)
- [机器证据](evidence/)

独立只读固定发布和页面历史的原始验收保留在[第七轮报告](archive/ROUND_7_IMPLEMENTATION.md)与[第六轮报告](archive/ROUND_6_IMPLEMENTATION.md)。参考资料由作者填写，系统没有自动抓取、逐句引用或事实核验。

## 后续优先级

1. 验证更合适的生成与定位能力，增加未参与提示词优化的保留样例，并进行人工校准；证明正文、热点与跨页质量后再决定是否启用候选。当前本地 2B 模型的失败不能推及其他模型。
2. 自动来源检索与逐句关联：先定义来源合约，再引入检索实现。
3. 跨浏览器与真实辅助技术验收，以及发布大作品的容量/长期负载评估。

跨版本工作流迁移、多执行器调度和协作权限需要单独设计与验收。现有部署仍只支持一个后端 worker/副本。

## 历史记录

[历史索引](archive/README.md)保留最初的审查、研究与第一至八轮验收，评估工具的起点见[第八轮报告](archive/ROUND_8_IMPLEMENTATION.md)。它们记录当时的实现和测试数字，不能作为当前功能或可运行命令的说明。旧 SQLite PoC 与不适配知识页合约的 36 场景 CLI 已退役；当前进程验证入口是 `scripts/verify_knowledge_generation.py`、`scripts/verify_version_history.py` 和 `scripts/verify_publications.py`。
