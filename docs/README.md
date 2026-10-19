# 文档导航

Flipbook Builder 是免账号、用户自备 API Key 的视觉知识工作台，面向个人或受信任环境中的单共享自托管实例。当前实现同时支持可编辑知识页与原图热点，发布为无需后端的静态作品。

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

页面草稿支持单页撤回；已保存内容可预览历史版本，并在保留现有分支的前提下恢复。恢复后重新人工核对；本地每页保留 50 版，服务器历史不主动裁剪，历史不进入 JSON/ZIP。2026-10-19 的完整本地验收结果、复测命令与边界见[验证说明](VERIFICATION.md)。

- [第六轮计划](ROUND_6_PLAN.md) / [实施报告](ROUND_6_IMPLEMENTATION.md)
- [桌面历史面板](images/round6-final-desktop-history.png) / [390px 手机历史面板](images/round6-final-mobile-history.png)
- [机器证据](evidence/)

测试使用本地受控供应商，不代表真实付费模型的知识质量。参考资料由作者填写，系统没有自动抓取、逐句引用或事实核验。

## 后续优先级

1. 独立只读发布：建立可固定版本的发布快照，继续复用共享播放器。
2. 固定样例的真实模型质量评估：在明确预算后，评估正文、热点和跨页一致性。
3. 自动来源检索与逐句关联：先定义来源合约，再引入检索实现。

跨版本工作流迁移、多执行器调度和协作权限需要单独设计与验收。现有部署仍只支持一个后端 worker/副本。

## 历史记录

[历史索引](archive/README.md)保留最初的审查、研究与早期验收。它们记录当时的实现和测试数字，不能作为当前功能或可运行命令的说明。旧 SQLite PoC 与不适配知识页合约的 36 场景 CLI 已退役；当前进程验证入口是 `scripts/verify_knowledge_generation.py` 和 `scripts/verify_version_history.py`。
