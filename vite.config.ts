import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import wasm from 'vite-plugin-wasm'
import path from 'path'
import fs from 'fs'
import http from 'http'
import pkg from './package.json'
import https from 'https'
import { worldsmithServerLauncher } from './vite-plugin-server-launcher'

/** 本地文件代理：将 /api/local-file?path=xxx 请求映射到本地文件系统 */
function localFilePlugin(): Plugin {
  const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'])
  const MIME_MAP: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  }

  return {
    name: 'local-file-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/local-file')) return next()

        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
        const filePath = url.searchParams.get('path')
        if (!filePath) {
          res.statusCode = 400
          res.end('Missing "path" query parameter')
          return
        }

        // 安全检查：只允许图片文件
        const ext = path.extname(filePath).toLowerCase()
        if (!IMAGE_EXTENSIONS.has(ext)) {
          res.statusCode = 403
          res.end('Only image files are allowed')
          return
        }

        // 解析路径：支持绝对路径和相对于项目根目录的相对路径
        const resolvedPath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(process.cwd(), filePath)

        // 安全检查：防止路径遍历（仅允许项目目录及其子目录，或常见图片目录）
        if (!fs.existsSync(resolvedPath)) {
          res.statusCode = 404
          res.end('File not found: ' + filePath)
          return
        }

        const mimeType = MIME_MAP[ext] || 'application/octet-stream'
        res.setHeader('Content-Type', mimeType)
        res.setHeader('Cache-Control', 'public, max-age=3600')
        res.setHeader('Access-Control-Allow-Origin', '*')

        try {
          const stream = fs.createReadStream(resolvedPath)
          stream.on('error', () => {
            if (!res.headersSent) {
              res.statusCode = 500
              res.end('Failed to read file')
            }
          })
          stream.pipe(res)
        } catch {
          res.statusCode = 500
          res.end('Failed to read file')
        }
      })
    },
  }
}

function customProxyPlugin(): Plugin {
  return {
    name: 'custom-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/custom-proxy')) return next()

        const targetUrl = req.headers['x-target-base-url'] as string
        if (!targetUrl) {
          res.statusCode = 400
          res.end('Missing X-Target-Base-Url header')
          return
        }

        let parsedTarget: URL
        try {
          parsedTarget = new URL(targetUrl)
        } catch {
          res.statusCode = 400
          res.end('Invalid X-Target-Base-Url')
          return
        }

        const proxyPath = req.url.replace(/^\/api\/custom-proxy/, '') || '/'
        const isHttps = parsedTarget.protocol === 'https:'
        const lib = isHttps ? https : http

        const forwardHeaders: Record<string, string> = {}
        for (const [key, value] of Object.entries(req.headers)) {
          if (key.startsWith('x-target-') || key.startsWith('sec-') || key === 'origin' || key === 'referer') continue
          if (typeof value === 'string') forwardHeaders[key] = value
          else if (Array.isArray(value)) forwardHeaders[key] = value.join(', ')
        }
        forwardHeaders['host'] = parsedTarget.host

        const options: https.RequestOptions = {
          hostname: parsedTarget.hostname,
          port: parsedTarget.port || (isHttps ? 443 : 80),
          path: proxyPath,
          method: req.method,
          headers: forwardHeaders,
          rejectUnauthorized: false,
        }

        console.log(`[custom-proxy] ${req.method} ${req.url} → ${parsedTarget.protocol}//${parsedTarget.host}${proxyPath}`)

        const proxyReq = lib.request(options, (proxyRes) => {
          console.log(`[custom-proxy] ← ${proxyRes.statusCode} ${req.url} content-type: ${proxyRes.headers['content-type']}`)
          res.writeHead(proxyRes.statusCode!, proxyRes.headers)
          proxyRes.pipe(res)
        })

        proxyReq.on('error', (err) => {
          console.error(`[custom-proxy] ERROR ${req.method} ${req.url}:`, err.message)
          if (!res.headersSent) {
            res.statusCode = 502
            res.end('Proxy error: ' + err.message)
          }
        })

        req.pipe(proxyReq)
      })
    },
  }
}

const aliases = {
  '@': path.resolve(__dirname, 'src'),
  '@agent': path.resolve(__dirname, 'worldsmith-agent/src'),
  '@worldsmith/entity-core$': path.resolve(__dirname, 'packages/entity-core/src'),
  '@worldsmith/entity-core/stores': path.resolve(__dirname, 'packages/entity-core/src/stores'),
  '@worldsmith/entity-core/core': path.resolve(__dirname, 'packages/entity-core/src/core'),
  '@worldsmith/entity-core/types': path.resolve(__dirname, 'packages/entity-core/src/types'),
  '@worldsmith/entity-core/composables': path.resolve(__dirname, 'packages/entity-core/src/composables'),
  '@worldsmith/entity-core/traits': path.resolve(__dirname, 'packages/entity-core/src/traits'),
  '@worldsmith/entity-core/facets': path.resolve(__dirname, 'packages/entity-core/src/facets'),
  '@worldsmith/entity-core/relations': path.resolve(__dirname, 'packages/entity-core/src/relations'),
  '@worldsmith/plugin-sdk$': path.resolve(__dirname, 'packages/plugin-sdk/src'),
  '@worldsmith/plugin-sdk/components': path.resolve(__dirname, 'packages/plugin-sdk/src/components'),
  '@worldsmith/plugin-sdk/composables': path.resolve(__dirname, 'packages/plugin-sdk/src/composables'),
  '@worldsmith/ui-kit$': path.resolve(__dirname, 'packages/ui-kit/src'),
  '@worldsmith/canvas-engine$': path.resolve(__dirname, 'packages/canvas-engine/src'),
  '@worldsmith/canvas-engine/core': path.resolve(__dirname, 'packages/canvas-engine/src/core'),
  '@worldsmith/canvas-engine/tree': path.resolve(__dirname, 'packages/canvas-engine/src/tree'),
  '@worldsmith/canvas-engine/graph': path.resolve(__dirname, 'packages/canvas-engine/src/graph'),
  '@worldsmith/canvas-engine/algorithms': path.resolve(__dirname, 'packages/canvas-engine/src/algorithms'),
  '@worldsmith/canvas-engine/geometry': path.resolve(__dirname, 'packages/canvas-engine/src/geometry'),
  '@worldsmith/motion-kit$': path.resolve(__dirname, 'packages/motion-kit/src'),
  '@worldsmith/font-kit$': path.resolve(__dirname, 'packages/font-kit/src'),
  '@worldsmith/font-kit/loader': path.resolve(__dirname, 'packages/font-kit/src/FontLoader'),
  '@worldsmith/font-kit/registry': path.resolve(__dirname, 'packages/font-kit/src/FontRegistry'),
  '@worldsmith/font-kit/wsfont': path.resolve(__dirname, 'packages/font-kit/src/WsFontPack'),
  '@worldsmith/font-kit/tokens': path.resolve(__dirname, 'packages/font-kit/src/tokens'),
  '@worldsmith/font-kit/renderer': path.resolve(__dirname, 'packages/font-kit/src/FontRenderer'),
  '@worldsmith/font-kit/animated': path.resolve(__dirname, 'packages/font-kit/src/AnimatedTextRenderer'),
  '@worldsmith/font-kit/tauri': path.resolve(__dirname, 'packages/font-kit/src/TauriFontBridge'),
  '@worldsmith/font-kit/composables': path.resolve(__dirname, 'packages/font-kit/src/composables'),
  '@worldsmith/agent-core$': path.resolve(__dirname, 'packages/agent-core/src'),
  '@worldsmith/agent-core/types': path.resolve(__dirname, 'packages/agent-core/src/types'),
  '@worldsmith/agent-core/guard': path.resolve(__dirname, 'packages/agent-core/src/guard'),
  '@worldsmith/agent-core/registry': path.resolve(__dirname, 'packages/agent-core/src/registry'),
  '@worldsmith/agent-core/bus': path.resolve(__dirname, 'packages/agent-core/src/bus'),
  '@worldsmith/agent-core/execution': path.resolve(__dirname, 'packages/agent-core/src/execution'),
  '@worldsmith/agent-core/factory': path.resolve(__dirname, 'packages/agent-core/src/factory'),
  '@worldsmith/core$': path.resolve(__dirname, 'worldsmith-core/pkg/index.js'),
  '@worldsmith/tactical-engine$': path.resolve(__dirname, 'tactical-engine/pkg/index.js'),
  '@worldsmith/perf-kit$': path.resolve(__dirname, 'packages/perf-kit/src'),
  '@worldsmith/perf-kit/reactive': path.resolve(__dirname, 'packages/perf-kit/src/reactive'),
  '@worldsmith/perf-kit/io': path.resolve(__dirname, 'packages/perf-kit/src/io'),
  '@worldsmith/perf-kit/render': path.resolve(__dirname, 'packages/perf-kit/src/render'),
  '@worldsmith/theme-kit': path.resolve(__dirname, 'packages/theme-kit/src'),
  '@worldsmith/memory-archive$': path.resolve(__dirname, 'packages/memory-archive/src'),
  '@worldsmith/memory-archive/types': path.resolve(__dirname, 'packages/memory-archive/src/types'),
  '@worldsmith/memory-archive/core': path.resolve(__dirname, 'packages/memory-archive/src/core'),
  '@worldsmith/memory-archive/adapters': path.resolve(__dirname, 'packages/memory-archive/src/adapters'),
  '@worldsmith/memory-archive/storage': path.resolve(__dirname, 'packages/memory-archive/src/storage'),
  '@worldsmith/memory-archive/embedding': path.resolve(__dirname, 'packages/memory-archive/src/embedding'),
  '@worldsmith/memory-archive/utils': path.resolve(__dirname, 'packages/memory-archive/src/utils'),
  '@worldsmith/governor-core$': path.resolve(__dirname, 'packages/governor-core/src'),
  '@worldsmith/governor-core/types': path.resolve(__dirname, 'packages/governor-core/src/types'),
  '@worldsmith/governor-core/registry': path.resolve(__dirname, 'packages/governor-core/src/registry'),
  '@worldsmith/governor-core/environment': path.resolve(__dirname, 'packages/governor-core/src/environment'),
  '@worldsmith/governor-core/governor': path.resolve(__dirname, 'packages/governor-core/src/governor'),
}

// 转换为数组形式（Vite 8 中对象形式的 $ 后缀 alias 不生效，需用数组形式）
const aliasArray = Object.entries(aliases).map(([key, value]) => {
  if (key.endsWith('$')) {
    // 精确匹配：使用正则 ^...$
    const escaped = key.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return { find: new RegExp(`^${escaped}$`), replacement: value as string }
  }
  return { find: key, replacement: value as string }
})

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [vue(), wasm(), worldsmithServerLauncher(), localFilePlugin(), customProxyPlugin()],
  resolve: {
    alias: aliasArray,
  },
  optimizeDeps: {
    include: ['docx', 'turndown'],
    exclude: ['@worldsmith/tactical-engine', '@worldsmith/core'],
  },
  server: {
    watch: {
      ignored: [
        '**/target/**',
        '**/dist/**',
        '**/WS备份/**',
        '**/.deepseek/**',
        '**/node_modules/.cache/**',
      ],
    },
    proxy: {
      '/api/anthropic': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/anthropic/, ''),
      },
      '/api/openai': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/openai/, ''),
      },
      '/api/google': {
        target: 'https://generativelanguage.googleapis.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/google/, ''),
      },
      '/api/deepseek': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/deepseek/, ''),
      },
      '/api/groq': {
        target: 'https://api.groq.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/groq/, ''),
      },
      '/api/openrouter': {
        target: 'https://openrouter.ai',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/openrouter/, ''),
      },
      '/api/zhipu': {
        target: 'https://open.bigmodel.cn',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/zhipu/, ''),
      },
      '/api/qwen': {
        target: 'https://dashscope.aliyuncs.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/qwen/, ''),
      },
      '/api/minimax': {
        target: 'https://api.minimax.chat',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/minimax/, ''),
      },
      '/api/kimi': {
        target: 'https://api.moonshot.cn',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/kimi/, ''),
      },
      '/api/agnes': {
        target: 'https://apihub.agnes-ai.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/agnes/, ''),
      },
      '/api/sensenova': {
        target: 'https://token.sensenova.cn',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/sensenova/, ''),
      },
      '/api/doubao': {
        target: 'https://ark.cn-beijing.volces.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/doubao/, ''),
      },
      '/api/xai': {
        target: 'https://api.x.ai',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/xai/, ''),
      },
      '/api/mistral': {
        target: 'https://api.mistral.ai',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/mistral/, ''),
      },
      '/api/stepfun': {
        target: 'https://api.stepfun.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/stepfun/, ''),
      },
      '/api/bytedance': {
        target: 'https://visual.volcengineapi.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/bytedance/, ''),
      },
      '/api/kling': {
        target: 'https://api.klingai.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/kling/, ''),
      },
    },
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
            if (id.includes('pdfjs-dist')) return 'vendor-pdf'
            if (id.includes('naive-ui')) return 'vendor-naive'
            if (id.includes('sigma') || id.includes('graphology')) return 'vendor-graph'
            if (id.includes('d3-')) return 'vendor-d3'
            if (id.includes('vis-timeline')) return 'vendor-timeline'
            if (id.includes('docx')) return 'vendor-docx'
            if (id.includes('mammoth')) return 'vendor-mammoth'
            if (id.includes('marked')) return 'vendor-marked'
            if (id.includes('jszip')) return 'vendor-jszip'
            if (id.includes('tiptap')) return 'vendor-tiptap'
          }
        },
      },
    },
  },
})
