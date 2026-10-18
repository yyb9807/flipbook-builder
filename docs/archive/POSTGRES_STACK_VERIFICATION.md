# Postgres 与三服务整栈验证

> 历史记录（2026-10-18）。本文保留当时状态；当前实现与可运行命令见[文档导航](../README.md)和[验证说明](../VERIFICATION.md)。旧 PoC / 36 场景 CLI 已退役。

2026-10-18 已完成本轮持久任务接入之前的真实整栈基线验证。此记录对应当前项目的上传/编辑与旧 children SSE 生成流程，持久任务故障恢复另见后续实测报告。

## 环境与隔离

- macOS ARM64，Docker Engine 29.6.2 / Compose v5.3.1。
- Compose project：`flipbook-verify-20261018`；独立卷 `flipbook-verify-20261018_postgres_data`。
- 数据库：PostgreSQL 16.15，宿主端口 `127.0.0.1:15434`；数据库/用户/测试密码均为 `flipbook`，仅用于本机隔离验证。
- 正式后端镜像运行 Python 3.13.16，前端为 Node 24 构建的正式 Vite 产物，运行在 nginx 1.27.5，访问地址 `http://127.0.0.1:18080`。
- 上传 bind mount：`/tmp/flipbook-stack-verification/uploads` → `/data`；未使用已有业务上传目录、数据库卷或容器。未执行现有项目的 `down -v`。
- Docker Desktop 初始关闭，本轮启动后验证。Docker Hub token 域返回连接 reset，改用 AWS Public ECR 的 Docker Official Image 镜像副本成功构建；产品默认基础镜像仍保持 Docker Hub，可通过三个 build args 选择镜像源。

## 结果

| 检查 | 实测结果 |
|---|---|
| 完整后端测试（真实 Postgres） | **145 passed**，记录运行 0.74s；没有跳过数据库集成测试 |
| 重复增量 schema | 集成测试中重复应用两次，已有标题/JSONB 场景仍保留 |
| 前后端正式容器构建 | 成功，后端 arm64 / 前端 arm64 |
| nginx → API / SPA / JS与CSS / 上传文件 | 全部可用，真实 HTTP，SPA 回退路由可用 |
| 上传 PNG → HTTP 视觉分析 → 数据库 | 成功，实际 agents 调用本地受控供应商，写入根页与两个归一化热点 |
| 场景编辑与跨项目节点归属 | JSONB 内容读写一致；其他项目更新该节点返回 404 |
| 跨节点热点批量修改 | 混入其他节点的热点返回 404，同批正确热点的修改回滚 |
| 子页部分失败及重试 | 首轮一页成功、另一页503失败，成功页保留；重试只补失败分支，最终两条子页链接、无重复页 |
| 导出 | JSON 保留场景与三个节点；ZIP 经 nginx 返回有效 ZIP |
| 上传响应安全头 | `nosniff` 与 `default-src 'none'; sandbox` 经 nginx 保留 |
| 真实容器重启 | 插入含场景 JSONB 的验证页，重启 backend（重新执行 lifespan/schema）后，HTTP 读取内容一致 |
| 临时项目清理 | 冒烟成功后仅删除本次临时项目，隔离数据库项目数归零 |

可重跑的 [HTTP 验证器](../../scripts/verify_stack.py) 共 **15 项检查**；机器可读实测结果在 [postgres-stack-20261018.json](evidence/postgres-stack-20261018.json)。供应商实际请求数：图片分析1次、成功分支规划1次、失败后重试分支规划2次。没有真实付费调用，没有配置图片生成 Key。

本轮发现并修复：

1. 旧数据库上传测试仍将21MB文件预期写为400，实际实现正确返回413；修正断言后全量通过。
2. Compose 固定容器名破坏隔离部署，移除固定名称，让 Compose project 命名隔离生效。
3. Dockerfile 增加可选 `PYTHON_IMAGE` / `NODE_IMAGE` / `NGINX_IMAGE`，用于网络受限环境选择可信官方镜像副本。

## 复现命令

在项目根目录，准备临时覆盖文件：

```sh
mkdir -p /tmp/flipbook-stack-verification/uploads /tmp/flipbook-stack-verification/evidence
cat > /tmp/flipbook-stack-verification/override.yml <<'YAML'
services:
  backend:
    volumes:
      - /tmp/flipbook-stack-verification/uploads:/data
YAML

export POSTGRES_PORT=15434 FRONTEND_PORT=18080
export PYTHON_IMAGE=public.ecr.aws/docker/library/python:3.13-slim
export NODE_IMAGE=public.ecr.aws/docker/library/node:24-alpine
export NGINX_IMAGE=public.ecr.aws/docker/library/nginx:1.27-alpine

docker compose -p flipbook-verify-20261018 -f docker-compose.yml \
  -f /tmp/flipbook-stack-verification/override.yml up -d db

cd backend
DATABASE_URL=postgresql://flipbook:flipbook@127.0.0.1:15434/flipbook \
  /tmp/flipbook-implementation-venv/bin/python -m pytest -q
cd ..

docker compose -p flipbook-verify-20261018 -f docker-compose.yml \
  -f /tmp/flipbook-stack-verification/override.yml up -d --build

/tmp/flipbook-implementation-venv/bin/python scripts/verify_stack.py \
  --base-url http://127.0.0.1:18080 \
  --provider-url http://host.docker.internal:19091/v1 \
  --evidence /tmp/flipbook-stack-verification/evidence/http-smoke.json
```

Python 验证器使用后端开发环境（`python -m pip install -r backend/requirements-dev.txt`，其中 Pillow 用于制作真实PNG）。Linux Docker 需为后端提供 `host.docker.internal:host-gateway`，或令 `--provider-url` 指向后端容器可达的宿主地址。验证器临时在宿主 `0.0.0.0:19091` 启动受控供应商，请勿将该测试端口暴露公网；进程结束自动关闭。合成测试 Key 只用于该本地假服务。

本机完整构建日志、pytest输出、容器重启读回 JSON 保存在 `/tmp/flipbook-stack-verification/evidence/`。源码中的验证器和机器结果可留存；临时目录不属于项目源文件。

## 实测边界

这里证明真实 Postgres 事务/迁移与三服务打包、反向代理链路可用，不能替代真实付费模型的质量和成本评估。HTTP 假供应商运行在网络边界之外，生成执行仍由正式后端和 agents 完成。持久任务、进程崩溃恢复与远端结果不确定窗口将由下一阶段正式工作流验收，不能从此基线推导其已经成立。
