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
| [贡献说明](../CONTRIBUTING.md) / [安全说明](../SECURITY.md) | 提交要求、凭据和部署边界 |

## 当前实施与验收

服务器作品可发布独立只读固定版本，冻结正文、分支、图片和阅读器。后续编辑、恢复、删源或升级不改变旧链接；全局发布记录仍可撤下删源后的版本。本地作品继续离线 ZIP。页面历史和草稿保护保留，历史不进入公开发布。2026-10-19 的完整本地验收、复测命令与边界见[验证说明](VERIFICATION.md)。

- [第七轮计划](ROUND_7_PLAN.md) / [实施报告](ROUND_7_IMPLEMENTATION.md)
- [桌面发布](images/round7-desktop-publish.png) / [390px 手机发布记录](images/round7-mobile-library.png)
- [第六轮页面历史与恢复](archive/ROUND_6_IMPLEMENTATION.md)
- [机器证据](evidence/)

测试使用本地受控供应商，不代表真实付费模型的知识质量。参考资料由作者填写，系统没有自动抓取、逐句引用或事实核验。

## 后续优先级

1. 固定样例的真实模型质量评估：在明确预算后，评估正文、热点和跨页一致性。
2. 自动来源检索与逐句关联：先定义来源合约，再引入检索实现。
3. 跨浏览器与真实辅助技术验收，以及发布大作品的容量/长期负载评估。

跨版本工作流迁移、多执行器调度和协作权限需要单独设计与验收。现有部署仍只支持一个后端 worker/副本。

## 历史记录

[历史索引](archive/README.md)保留最初的审查、研究与早期验收。它们记录当时的实现和测试数字，不能作为当前功能或可运行命令的说明。旧 SQLite PoC 与不适配知识页合约的 36 场景 CLI 已退役；当前进程验证入口是 `scripts/verify_knowledge_generation.py`、`scripts/verify_version_history.py` 和 `scripts/verify_publications.py`。
