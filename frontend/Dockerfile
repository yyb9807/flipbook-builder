# ── Stage 1: build ────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# 利用 layer 缓存：先只拷 package 文件
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
# 跳过 tsc -b（type-check 是 dev/CI 职责，生产构建不需要）；vite 用 esbuild 转译已足够。
RUN npx vite build

# ── Stage 2: runtime (nginx) ─────────────────────────────────
FROM nginx:1.27-alpine

# 自定义 nginx 配置：前端静态 + /api + /uploads 反代到后端
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 静态产物
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
