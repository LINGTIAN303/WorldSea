/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// Web 端环境变量（VITE_CLI_SERVE_URL / VITE_CLI_SERVE_TOKEN 等）
interface ImportMetaEnv {
  readonly VITE_CLI_SERVE_URL?: string
  readonly VITE_CLI_SERVE_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
