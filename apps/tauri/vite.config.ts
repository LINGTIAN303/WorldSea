import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import wasm from 'vite-plugin-wasm'
import { compression } from 'vite-plugin-compression2'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'path'
import pkg from './package.json'

/** Tauri 端 Vite 配置（设计原则/端口/后端连接），详细见 docs/details/注释/tauri/vite-config.md */

// ────────────────────────── Alias 配置 ──────────────────────────
// 共享包 alias（指向源码，便于 HMR 和调试）
// 业务代码 alias 等 Phase 3 迁入 src/ 后再补充
const aliases: Record<string, string> = {
  '@': path.resolve(__dirname, 'src'),
  // 共享运行时层
  '@worldsea/agent-runtime$': path.resolve(__dirname, '../../packages/agent-runtime/src'),
  '@worldsea/agent-runtime/execution': path.resolve(__dirname, '../../packages/agent-runtime/src/execution'),
  '@worldsea/agent-runtime/execution/adapter': path.resolve(__dirname, '../../packages/agent-runtime/src/execution/adapter'),
  '@worldsea/agent-runtime/bridge-types': path.resolve(__dirname, '../../packages/agent-runtime/src/bridge-types'),
  '@worldsea/agent-runtime/toolbus': path.resolve(__dirname, '../../packages/agent-runtime/src/toolbus'),
  '@worldsea/agent-runtime/tools': path.resolve(__dirname, '../../packages/agent-runtime/src/tools'),
  '@worldsea/agent-core$': path.resolve(__dirname, '../../packages/agent-core/src'),
  '@worldsea/agent-core/types': path.resolve(__dirname, '../../packages/agent-core/src/types'),
  '@worldsea/agent-core/guard': path.resolve(__dirname, '../../packages/agent-core/src/guard'),
  '@worldsea/agent-core/registry': path.resolve(__dirname, '../../packages/agent-core/src/registry'),
  '@worldsea/agent-core/bus': path.resolve(__dirname, '../../packages/agent-core/src/bus'),
  '@worldsea/agent-core/execution': path.resolve(__dirname, '../../packages/agent-core/src/execution'),
  '@worldsea/agent-core/factory': path.resolve(__dirname, '../../packages/agent-core/src/factory'),
  '@worldsea/governor-core$': path.resolve(__dirname, '../../packages/governor-core/src'),
  '@worldsea/governor-core/types': path.resolve(__dirname, '../../packages/governor-core/src/types'),
  '@worldsea/governor-core/registry': path.resolve(__dirname, '../../packages/governor-core/src/registry'),
  '@worldsea/governor-core/environment': path.resolve(__dirname, '../../packages/governor-core/src/environment'),
  '@worldsea/governor-core/governor': path.resolve(__dirname, '../../packages/governor-core/src/governor'),
  // 共享 composables（Phase 3 迁入）
  '@worldsea/shared-composables$': path.resolve(__dirname, '../../packages/shared-composables/src'),
  '@worldsea/shared-composables/agent': path.resolve(__dirname, '../../packages/shared-composables/src/agent'),
  '@worldsea/shared-composables/agent/long-task': path.resolve(__dirname, '../../packages/shared-composables/src/agent/long-task'),
  '@worldsea/shared-composables/long-task': path.resolve(__dirname, '../../packages/shared-composables/src/agent/long-task'),
  // @agent/* alias — 共享包内部引用 agent-runtime 的统一别名
  // 注意：通配指向 packages/agent-runtime/src/*，避免引入 worldsea-agent/src/*（CLI 端代码）
  // 具体子路径（orchestrator/providers/skills/context/group-chat/session/execution）由通配自动覆盖
  '@agent/': path.resolve(__dirname, '../../packages/agent-runtime/src/'),
  // 业务无关的共享 UI/工具包
  '@worldsea/entity-core$': path.resolve(__dirname, '../../packages/entity-core/src'),
  '@worldsea/entity-core/stores': path.resolve(__dirname, '../../packages/entity-core/src/stores'),
  '@worldsea/entity-core/core': path.resolve(__dirname, '../../packages/entity-core/src/core'),
  '@worldsea/entity-core/types': path.resolve(__dirname, '../../packages/entity-core/src/types'),
  '@worldsea/entity-core/composables': path.resolve(__dirname, '../../packages/entity-core/src/composables'),
  '@worldsea/entity-core/traits': path.resolve(__dirname, '../../packages/entity-core/src/traits'),
  '@worldsea/entity-core/facets': path.resolve(__dirname, '../../packages/entity-core/src/facets'),
  '@worldsea/entity-core/relations': path.resolve(__dirname, '../../packages/entity-core/src/relations'),
  '@worldsea/plugin-sdk$': path.resolve(__dirname, '../../packages/plugin-sdk/src'),
  '@worldsea/plugin-sdk/components': path.resolve(__dirname, '../../packages/plugin-sdk/src/components'),
  '@worldsea/plugin-sdk/composables': path.resolve(__dirname, '../../packages/plugin-sdk/src/composables'),
  '@worldsea/ui-kit$': path.resolve(__dirname, '../../packages/ui-kit/src'),
  // ui-kit 子路径（components/* / composables/*）：带斜杠前缀 → 正则形式（见下方转换规则）。
  // 与 node_modules 链接无关，直接指向源码，HMR 与构建同口径
  '@worldsea/ui-kit/': path.resolve(__dirname, '../../packages/ui-kit/src/'),
  '@worldsea/canvas-engine$': path.resolve(__dirname, '../../packages/canvas-engine/src'),
  '@worldsea/canvas-engine/core': path.resolve(__dirname, '../../packages/canvas-engine/src/core'),
  '@worldsea/canvas-engine/tree': path.resolve(__dirname, '../../packages/canvas-engine/src/tree'),
  '@worldsea/canvas-engine/graph': path.resolve(__dirname, '../../packages/canvas-engine/src/graph'),
  '@worldsea/canvas-engine/algorithms': path.resolve(__dirname, '../../packages/canvas-engine/src/algorithms'),
  '@worldsea/canvas-engine/geometry': path.resolve(__dirname, '../../packages/canvas-engine/src/geometry'),
  '@worldsea/motion-kit$': path.resolve(__dirname, '../../packages/motion-kit/src'),
  '@worldsea/font-kit$': path.resolve(__dirname, '../../packages/font-kit/src'),
  '@worldsea/font-kit/loader': path.resolve(__dirname, '../../packages/font-kit/src/FontLoader'),
  '@worldsea/font-kit/registry': path.resolve(__dirname, '../../packages/font-kit/src/FontRegistry'),
  '@worldsea/font-kit/wsfont': path.resolve(__dirname, '../../packages/font-kit/src/WsFontPack'),
  '@worldsea/font-kit/tokens': path.resolve(__dirname, '../../packages/font-kit/src/tokens'),
  '@worldsea/font-kit/renderer': path.resolve(__dirname, '../../packages/font-kit/src/FontRenderer'),
  '@worldsea/font-kit/animated': path.resolve(__dirname, '../../packages/font-kit/src/AnimatedTextRenderer'),
  // Tauri 专用字体桥接（Tauri 端独有）
  '@worldsea/font-kit/tauri': path.resolve(__dirname, '../../packages/font-kit/src/TauriFontBridge'),
  '@worldsea/font-kit/composables': path.resolve(__dirname, '../../packages/font-kit/src/composables'),
  '@worldsea/perf-kit$': path.resolve(__dirname, '../../packages/perf-kit/src'),
  '@worldsea/perf-kit/reactive': path.resolve(__dirname, '../../packages/perf-kit/src/reactive'),
  '@worldsea/perf-kit/io': path.resolve(__dirname, '../../packages/perf-kit/src/io'),
  '@worldsea/perf-kit/render': path.resolve(__dirname, '../../packages/perf-kit/src/render'),
  // 共享 UI（Phase 5.3 抽取，A2UI 渲染组件）
  '@worldsea/shared-ui$': path.resolve(__dirname, '../../packages/shared-ui/src'),
  '@worldsea/shared-ui/agent': path.resolve(__dirname, '../../packages/shared-ui/src/agent'),
  '@worldsea/shared-ui/agent/a2ui': path.resolve(__dirname, '../../packages/shared-ui/src/agent/a2ui'),
  '@worldsea/theme-kit': path.resolve(__dirname, '../../packages/theme-kit/src'),
  // WASM 包（算法降级用 — Tauri 命令不可用时的回退）
  '@worldsea/core$': path.resolve(__dirname, '../../worldsea-core/pkg/index.js'),
  '@worldsea/tactical-engine$': path.resolve(__dirname, '../../tactical-engine/pkg/index.js'),
}

// Vite 8 + Rolldown 中 alias 解析规则：
// - 字符串形式：严格前缀匹配，但 Rolldown 对带斜杠的字符串前缀（如 '@agent/'）支持不稳定
// - 正则形式：明确可靠，优先使用
// 转换规则：
// - key 以 '$' 结尾 → 精确匹配正则（如 '@worldsea/ui-kit$' → /^@worldsea\/ui-kit$/）
// - key 以 '/' 结尾 → 前缀匹配正则（如 '@agent/' → /^@agent\//），确保子路径正确解析
// - 其他 → 字符串前缀匹配（Vite 默认行为）
const aliasArray = Object.entries(aliases).map(([key, value]) => {
  if (key.endsWith('$')) {
    const escaped = key.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return { find: new RegExp(`^${escaped}$`), replacement: value }
  }
  if (key.endsWith('/')) {
    // 前缀匹配：@agent/ → 匹配 @agent/ 开头的所有导入（如 @agent/tools/a2ui-helpers）
    // 正则匹配含斜杠的前缀（^@agent/），replacement 需末尾补斜杠（path.resolve 会去掉末尾斜杠）
    const escaped = key.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return { find: new RegExp(`^${escaped}/`), replacement: value.endsWith('/') ? value : value + '/' }
  }
  return { find: key, replacement: value }
})

// ────────────────────────── Provider /api 代理（浏览器 preview 场景） ──────────────────────────
// 浏览器 preview（trae-preview / 纯 Web 预览）无法走 Tauri IPC，`/api/<provider>` 请求由
// Vite 在此转发到对应供应商上游，绕过浏览器 CORS（changeOrigin 伪造成同源）。
// 键：provider 的 proxyPath（浏览器侧调用路径前缀）
// 值：该 provider 的 directBaseUrl（上游真实 Base URL）
// 匹配 / 转发：把 key 前缀重写为空后拼接到 target（与 provider-registry.buildRequestUrl 一致）
const PROVIDER_PROXY: Record<string, string> = {
  '/api/anthropic': 'https://api.anthropic.com',
  '/api/openai/v1': 'https://api.openai.com',
  '/api/google': 'https://generativelanguage.googleapis.com',
  '/api/deepseek': 'https://api.deepseek.com',
  '/api/groq/openai/v1': 'https://api.groq.com/openai',
  '/api/openrouter/api/v1': 'https://openrouter.ai/api',
  '/api/zhipu/api/paas/v4': 'https://open.bigmodel.cn/api/paas/v4',
  '/api/qwen/compatible-mode/v1': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  '/api/minimax/v1': 'https://api.minimax.chat/v1',
  '/api/kimi/v1': 'https://api.moonshot.cn/v1',
  '/api/agnes/v1': 'https://api.agnesai.com/v1',
  '/api/sensenova/v1': 'https://token.sensenova.cn/v1',
  '/api/doubao/api/v3': 'https://ark.cn-beijing.volces.com/api/v3',
  '/api/xai/v1': 'https://api.x.ai',
  '/api/mistral/v1': 'https://api.mistral.ai',
  '/api/stepfun/v1': 'https://api.stepfun.com',
  '/api/mimo/v1': 'https://api.xiaomimimo.com/v1',
  '/api/siliconflow/v1': 'https://api.siliconflow.cn/v1',
  '/api/tencentcloud/v1': 'https://api.cloud.tencent.com',
  '/api/longcat/v1': 'https://api.longcat.chat/v1',
  '/api/dots/v1': 'https://api.dots.ai/v1',
  '/api/xfyun/v1': 'https://maas-api.xfyun.cn/v1',
  '/api/bailian/compatible-mode/v1': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  '/api/modelscope/v1': 'https://api-inference.modelscope.cn/v1',
  '/api/kling/v1': 'https://api.klingai.com',
}

const providerProxy: Record<string, string | Record<string, unknown>> = {}
for (const [key, target] of Object.entries(PROVIDER_PROXY)) {
  providerProxy[key] = {
    target,
    changeOrigin: true,
    secure: false,
    rewrite: (p: string) => (p.startsWith(key) ? p.slice(key.length) || '/' : p),
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Tauri 端硬编码后端类型（Phase 3 完成后此字段将移除，改用端入口注入）
    '__TAURI__': JSON.stringify(true),
  },
  plugins: [
    vue(),
    wasm(),
    // gzip + brotli 压缩（10KB 以上才压缩，保留原文件）
    // 注：Tauri 端产物会被打包进二进制，压缩可减小安装包体积
    compression({
      algorithms: ['gzip', 'brotliCompress'],
      threshold: 10240,
      deleteOriginalAssets: false,
    }),
    // chunk 可视化分析报告（build 后生成 dist-stats.html）
    visualizer({
      filename: 'dist-stats.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  resolve: {
    alias: aliasArray,
  },
  optimizeDeps: {
    // 预构建常见重依赖（减少首次启动时间）
    include: ['docx', 'turndown'],
    // WASM 包不预构建（rollup 无法处理）
    exclude: ['@worldsea/tactical-engine', '@worldsea/core'],
  },
  server: {
    port: 5175,
    strictPort: true, // 避免端口漂移（tauri.conf.json 指定了 5175）
    watch: {
      ignored: [
        '**/target/**',
        '**/dist/**',
        '**/WS备份/**',
        '**/.deepseek/**',
        '**/node_modules/.cache/**',
      ],
    },
    // Provider /api 代理（浏览器 preview 场景）：Tauri IPC 组不受影响，
    // 仅当请求命中 /api/* 且命中 PROVIDER_PROXY 时转发到上游。
    proxy: providerProxy,
  },
  // Worker 格式：WASM top-level await 需要 ES 格式（iife 不支持）
  // 修复 vite 8 + rolldown worker 默认 iife 导致的 build 失败
  worker: {
    format: 'es',
  },
  build: {
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // 文档处理类（按需加载，非首屏）
            if (id.includes('pdfjs-dist')) return 'vendor-pdf'
            if (id.includes('docx')) return 'vendor-docx'
            if (id.includes('mammoth')) return 'vendor-mammoth'
            if (id.includes('jszip')) return 'vendor-jszip'
            if (id.includes('js-yaml')) return 'vendor-yaml'
            if (id.includes('marked')) return 'vendor-marked'
            // UI 框架与图标
            if (id.includes('lucide-vue-next')) return 'vendor-lucide'
            // 可视化与图形（非首屏）
            if (id.includes('sigma') || id.includes('graphology')) return 'vendor-graph'
            if (id.includes('d3-force')) return 'vendor-d3'
            if (id.includes('echarts')) return 'vendor-echarts'
            // 编辑器与终端（非首屏）
            if (id.includes('tiptap')) return 'vendor-tiptap'
            if (id.includes('@xterm')) return 'vendor-xterm'
            // 数据与工具
            if (id.includes('dexie')) return 'vendor-dexie'
            if (id.includes('gpt-tokenizer')) return 'vendor-tokenizer'
            if (id.includes('dompurify')) return 'vendor-dompurify'
            if (id.includes('turndown')) return 'vendor-turndown'
            if (id.includes('segmentit')) return 'vendor-segmentit'
            if (id.includes('vuedraggable')) return 'vendor-draggable'
          }
        },
      },
    },
  },
})
