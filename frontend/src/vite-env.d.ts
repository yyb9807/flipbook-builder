/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端 API 基址，仅 SSE 流用（普通 API 走 Vite proxy /api）。
   *  开发环境留空，自动用 localhost:8000；生产部署时设置为反代域名。 */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
