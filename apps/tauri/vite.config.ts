import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import wasm from 'vite-plugin-wasm'
import { compression } from 'vite-plugin-compression2'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'path'
import pkg from './package.json'

/**
 * Tauri 端 Vite 配置（Phase 5 独立构建）
 *
 * 设计原则：
 * 1. 通过 Tauri IPC 调用 Rust 命令（不走 HTTP/WS）
 * 2. WASM 后端用于算法降级（当 Tauri 命令不可用时，如开发期 hot reload）
 * 3. 不需要 /api/* 代理（Tauri 端通过 IPC 直接访问系统能力）
 * 4. Tauri dev 由 tauri.conf.json 的 beforeDevCommand 触发此 Vite 服务器
 *
 * 端口：5175（避免与 Web 端 5174、主项目 5173 冲突）
 * 后端连接：Tauri IPC（TauriExecutionAdapter）
 */

// ────────────────────────── Alias 配置 ──────────────────────────
// 共享包 alias（指向源码，便于 HMR 和调试）
// 业务代码 alias 等 Phase 3 迁入 src/ 后再补充
const aliases: Record<string, string> = {
  '@': path.resolve(__dirname, 'src'),
  // 共享运行时层
  '@worldsmith/agent-runtime$': path.resolve(__dirname, '../../packages/agent-runtime/src'),
  '@worldsmith/agent-runtime/execution': path.resolve(__dirname, '../../packages/agent-runtime/src/execution'),
  '@worldsmith/agent-runtime/execution/adapter': path.resolve(__dirname, '../../packages/agent-runtime/src/execution/adapter'),
  '@worldsmith/agent-runtime/bridge-types': path.resolve(__dirname, '../../packages/agent-runtime/src/bridge-types'),
  '@worldsmith/agent-core$': path.resolve(__dirname, '../../packages/agent-core/src'),
  '@worldsmith/agent-core/types': path.resolve(__dirname, '../../packages/agent-core/src/types'),
  '@worldsmith/agent-core/guard': path.resolve(__dirname, '../../packages/agent-core/src/guard'),
  '@worldsmith/agent-core/registry': path.resolve(__dirname, '../../packages/agent-core/src/registry'),
  '@worldsmith/agent-core/bus': path.resolve(__dirname, '../../packages/agent-core/src/bus'),
  '@worldsmith/agent-core/execution': path.resolve(__dirname, '../../packages/agent-core/src/execution'),
  '@worldsmith/agent-core/factory': path.resolve(__dirname, '../../packages/agent-core/src/factory'),
  '@worldsmith/governor-core$': path.resolve(__dirname, '../../packages/governor-core/src'),
  '@worldsmith/governor-core/types': path.resolve(__dirname, '../../packages/governor-core/src/types'),
  '@worldsmith/governor-core/registry': path.resolve(__dirname, '../../packages/governor-core/src/registry'),
  '@worldsmith/governor-core/environment': path.resolve(__dirname, '../../packages/governor-core/src/environment'),
  '@worldsmith/governor-core/governor': path.resolve(__dirname, '../../packages/governor-core/src/governor'),
  // 共享 composables（Phase 3 迁入）
  '@worldsmith/shared-composables$': path.resolve(__dirname, '../../packages/shared-composables/src'),
  '@worldsmith/shared-composables/agent': path.resolve(__dirname, '../../packages/shared-composables/src/agent'),
  '@worldsmith/shared-composables/agent/long-task': path.resolve(__dirname, '../../packages/shared-composables/src/agent/long-task'),
  '@worldsmith/shared-composables/long-task': path.resolve(__dirname, '../../packages/shared-composables/src/agent/long-task'),
  // @agent/* alias — 共享包内部引用 agent-runtime 的统一别名
  // 注意：通配指向 packages/agent-runtime/src/*，避免引入 worldsmith-agent/src/*（CLI 端代码）
  // 具体子路径（orchestrator/providers/skills/context/group-chat/session/execution）由通配自动覆盖
  '@agent/': path.resolve(__dirname, '../../packages/agent-runtime/src/'),
  // 业务无关的共享 UI/工具包
  '@worldsmith/entity-core$': path.resolve(__dirname, '../../packages/entity-core/src'),
  '@worldsmith/entity-core/stores': path.resolve(__dirname, '../../packages/entity-core/src/stores'),
  '@worldsmith/entity-core/core': path.resolve(__dirname, '../../packages/entity-core/src/core'),
  '@worldsmith/entity-core/types': path.resolve(__dirname, '../../packages/entity-core/src/types'),
  '@worldsmith/entity-core/composables': path.resolve(__dirname, '../../packages/entity-core/src/composables'),
  '@worldsmith/entity-core/traits': path.resolve(__dirname, '../../packages/entity-core/src/traits'),
  '@worldsmith/entity-core/facets': path.resolve(__dirname, '../../packages/entity-core/src/facets'),
  '@worldsmith/entity-core/relations': path.resolve(__dirname, '../../packages/entity-core/src/relations'),
  '@worldsmith/plugin-sdk$': path.resolve(__dirname, '../../packages/plugin-sdk/src'),
  '@worldsmith/plugin-sdk/components': path.resolve(__dirname, '../../packages/plugin-sdk/src/components'),
  '@worldsmith/plugin-sdk/composables': path.resolve(__dirname, '../../packages/plugin-sdk/src/composables'),
  '@worldsmith/ui-kit$': path.resolve(__dirname, '../../packages/ui-kit/src'),
  '@worldsmith/canvas-engine$': path.resolve(__dirname, '../../packages/canvas-engine/src'),
  '@worldsmith/canvas-engine/core': path.resolve(__dirname, '../../packages/canvas-engine/src/core'),
  '@worldsmith/canvas-engine/tree': path.resolve(__dirname, '../../packages/canvas-engine/src/tree'),
  '@worldsmith/canvas-engine/graph': path.resolve(__dirname, '../../packages/canvas-engine/src/graph'),
  '@worldsmith/canvas-engine/algorithms': path.resolve(__dirname, '../../packages/canvas-engine/src/algorithms'),
  '@worldsmith/canvas-engine/geometry': path.resolve(__dirname, '../../packages/canvas-engine/src/geometry'),
  '@worldsmith/motion-kit$': path.resolve(__dirname, '../../packages/motion-kit/src'),
  '@worldsmith/font-kit$': path.resolve(__dirname, '../../packages/font-kit/src'),
  '@worldsmith/font-kit/loader': path.resolve(__dirname, '../../packages/font-kit/src/FontLoader'),
  '@worldsmith/font-kit/registry': path.resolve(__dirname, '../../packages/font-kit/src/FontRegistry'),
  '@worldsmith/font-kit/wsfont': path.resolve(__dirname, '../../packages/font-kit/src/WsFontPack'),
  '@worldsmith/font-kit/tokens': path.resolve(__dirname, '../../packages/font-kit/src/tokens'),
  '@worldsmith/font-kit/renderer': path.resolve(__dirname, '../../packages/font-kit/src/FontRenderer'),
  '@worldsmith/font-kit/animated': path.resolve(__dirname, '../../packages/font-kit/src/AnimatedTextRenderer'),
  // Tauri 专用字体桥接（Tauri 端独有）
  '@worldsmith/font-kit/tauri': path.resolve(__dirname, '../../packages/font-kit/src/TauriFontBridge'),
  '@worldsmith/font-kit/composables': path.resolve(__dirname, '../../packages/font-kit/src/composables'),
  '@worldsmith/perf-kit$': path.resolve(__dirname, '../../packages/perf-kit/src'),
  '@worldsmith/perf-kit/reactive': path.resolve(__dirname, '../../packages/perf-kit/src/reactive'),
  '@worldsmith/perf-kit/io': path.resolve(__dirname, '../../packages/perf-kit/src/io'),
  '@worldsmith/perf-kit/render': path.resolve(__dirname, '../../packages/perf-kit/src/render'),
  '@worldsmith/theme-kit': path.resolve(__dirname, '../../packages/theme-kit/src'),
  '@worldsmith/memory-archive$': path.resolve(__dirname, '../../packages/memory-archive/src'),
  '@worldsmith/memory-archive/types': path.resolve(__dirname, '../../packages/memory-archive/src/types'),
  '@worldsmith/memory-archive/core': path.resolve(__dirname, '../../packages/memory-archive/src/core'),
  '@worldsmith/memory-archive/adapters': path.resolve(__dirname, '../../packages/memory-archive/src/adapters'),
  '@worldsmith/memory-archive/storage': path.resolve(__dirname, '../../packages/memory-archive/src/storage'),
  '@worldsmith/memory-archive/embedding': path.resolve(__dirname, '../../packages/memory-archive/src/embedding'),
  '@worldsmith/memory-archive/utils': path.resolve(__dirname, '../../packages/memory-archive/src/utils'),
  // WASM 包（算法降级用 — Tauri 命令不可用时的回退）
  '@worldsmith/core$': path.resolve(__dirname, '../../worldsmith-core/pkg/index.js'),
  '@worldsmith/tactical-engine$': path.resolve(__dirname, '../../tactical-engine/pkg/index.js'),
}

// Vite 8 + Rolldown 中 alias 解析规则：
// - 字符串形式：严格前缀匹配，但 Rolldown 对带斜杠的字符串前缀（如 '@agent/'）支持不稳定
// - 正则形式：明确可靠，优先使用
// 转换规则：
// - key 以 '$' 结尾 → 精确匹配正则（如 '@worldsmith/ui-kit$' → /^@worldsmith\/ui-kit$/）
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
    exclude: ['@worldsmith/tactical-engine', '@worldsmith/core'],
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
    // Tauri 端不需要 /api/* 代理 — 通过 IPC 直接调用 Rust 命令
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
            if (id.includes('naive-ui')) return 'vendor-naive'
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
