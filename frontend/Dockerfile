# ── Stage 1: build ────────────────────────────────────────────
ARG NODE_IMAGE=node:24-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine
FROM ${NODE_IMAGE} AS builder

WORKDIR /app

# 利用 layer 缓存：先只拷 package 文件
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
# 与本地及 CI 使用相同的类型检查和正式构建。
RUN npm run build

# ── Stage 2: runtime (nginx) ─────────────────────────────────
FROM ${NGINX_IMAGE}

# 自定义 nginx 配置：前端静态 + /api + /uploads 反代到后端
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 静态产物
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
