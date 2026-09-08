# 05 - CLI 端分离计划

> 目标：建立独立的 `apps/cli/` 子项目，作为 Node.js 命令行应用。
> 提供 `chat`（交互式对话）与 `serve`（HTTP+WS 服务器）两个子命令。

## 1. 目录结构

```
apps/cli/
├── src/
│   ├── bin/
│   │   └── cli.mjs                     # CLI 入口（从 worldsea-agent/bin/ 迁移）
│   ├── commands/                       # commander 命令
│   │   ├── chat.ts                     # 交互式对话（从 worldsea-agent/src/cli/index.ts 拆分）
│   │   └── serve.ts                    # HTTP+WS 服务器（从 worldsea-agent/src/cli/serve.ts 迁移）
│   ├── stores/                         # CLI 版 stores（从 worldsea-agent/src/cli/stores/ 迁移）
│   │   ├── cli-entity-store.ts
│   │   ├── cli-file-store.ts
│   │   ├── cli-relation-store.ts
│   │   ├── cli-settings-store.ts
│   │   ├── cli-ui-store.ts
│   │   └── json-store.ts
│   ├── context/                        # CLI 工具上下文
│   │   └── cli-context.ts             # 从 worldsea-agent/src/cli/cli-context.ts 迁移
│   ├── safety-guard.ts                 # 安全防护（从 cli-safety-guard.ts 迁移）
│   ├── session-store.ts                # 会话存储（从 cli-session-store.ts 迁移）
│   ├── agent.ts                        # CLI Agent 实现（从 cli-agent.ts 迁移）
│   ├── execution/
│   │   └── node-adapter.ts            # Node 环境适配器（从 worldsea-agent/src/execution/ 迁移）
│   └── index.ts                        # CLI 主入口（commander 配置）
├── tsconfig.json                       # CLI 专属 tsconfig
├── tsconfig.cli.json                   # CLI 编译配置（从 worldsea-agent/tsconfig.cli.json 迁移）
└── package.json                        # CLI 专属 package.json
```

## 2. package.json

```json
{
  "name": "@worldsea/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "worldsea": "./src/bin/cli.mjs"
  },
  "scripts": {
    "dev": "tsx src/bin/cli.mjs",
    "build": "tsc -p tsconfig.cli.json",
    "cli": "tsx src/bin/cli.mjs",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@worldsea/agent-runtime": "workspace:*",
    "commander": "^14.0.3",
    "dexie": "^4.4.2",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22.0.0",
    "@types/ws": "^8.18.0",
    "tsx": "^4.19.0",
    "typescript": "~6.0.2"
  }
}
```

**关键差异**：
- 无 `vue` / `pinia` / `naive-ui` / `@tiptap/*` 等前端依赖
- 无 `@tauri-apps/*`
- 无 WASM 依赖
- 仅依赖 `@worldsea/agent-runtime` + `commander` + `ws` + `dexie`

## 3. tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "baseUrl": ".",
    "paths": {
      "@worldsea/agent-runtime": ["../../packages/agent-runtime/src"],
      "@worldsea/agent-runtime/*": ["../../packages/agent-runtime/src/*"]
    }
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/__tests__/**"],
  "references": [
    { "path": "../../packages/agent-runtime" }
  ]
}
```

## 4. 入口改造

### 4.1 bin/cli.mjs

```javascript
#!/usr/bin/env node
/**
 * WorldSea CLI 入口
 *
 * 用法：
 *   worldsea chat [options]     交互式对话
 *   worldsea serve [options]    启动 HTTP+WS 服务器（供 Web 端连接）
 *   worldsea --help
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

// 使用 tsx 运行时注册 TypeScript 支持
register('tsx', pathToFileURL(import.meta.url))

// 导入并运行 CLI 主逻辑
import '../src/index.ts'
```

### 4.2 src/index.ts（commander 主入口）

```typescript
// apps/cli/src/index.ts
import { Command } from 'commander'
import { registerExecutionAdapterFactory } from '@worldsea/agent-runtime'
import { NodeExecutionAdapter } from './execution/node-adapter'
import { chatCommand } from './commands/chat'
import { serveCommand } from './commands/serve'

// 注册 Node 环境 ExecutionAdapter
registerExecutionAdapterFactory({
  createNodeAdapter: () => new NodeExecutionAdapter(),
})

const program = new Command()

program
  .name('worldsea')
  .description('AI-powered worldbuilding CLI')
  .version('0.1.0')

program.addCommand(chatCommand)
program.addCommand(serveCommand)

program.parse()
```

### 4.3 commands/chat.ts

```typescript
// apps/cli/src/commands/chat.ts
import { Command } from 'commander'
import { createAgent } from '@worldsea/agent-runtime'
import { createCliAgent } from '../agent'
import { createCliToolContext } from '../context/cli-context'
import { createCLISafetyGuard } from '../safety-guard'
import { initToolMetaRegistry } from '@worldsea/agent-runtime'

export const chatCommand = new Command('chat')
  .description('交互式对话')
  .option('-p, --provider <name>', 'LLM 供应商')
  .option('-m, --model <name>', '模型名')
  .option('-a, --api-key <key>', 'API Key')
  .option('-d, --data <path>', '数据目录', './.worldsea')
  .option('--no-guard', '禁用安全防护')
  .action(async (options) => {
    await initToolMetaRegistry()
    const safetyGuard = options.guard ? createCLISafetyGuard() : null
    const context = createCliToolContext({ dataDir: options.data, safetyGuard })
    const agent = await createCliAgent({
      provider: options.provider,
      model: options.model,
      apiKey: options.apiKey,
      context,
    })
    // 启动交互式对话（原 cli/index.ts 的 chat 逻辑）
    await startInteractiveChat(agent)
  })

async function startInteractiveChat(agent: any) {
  // 原 cli/index.ts 的交互逻辑
  // ...
}
```

### 4.4 commands/serve.ts

```typescript
// apps/cli/src/commands/serve.ts
import { Command } from 'commander'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { createCliAgent, CLI_TOOLS } from '../agent'
import { createCliToolContext } from '../context/cli-context'
import { createCLISafetyGuard } from '../safety-guard'
import { initToolMetaRegistry, registerExecutionAdapterFactory } from '@worldsea/agent-runtime'
import { NodeExecutionAdapter } from '../execution/node-adapter'
// 整合 worldsea-server 能力
import { pythonBridge } from './python-bridge'
import { ptyManager } from './pty-manager'
import { terminalLauncher } from './terminal-launcher'

export const serveCommand = new Command('serve')
  .description('启动 HTTP+WS 服务器（供 Web 端连接）')
  .option('-p, --port <number>', '端口', '3100')
  .option('-h, --host <addr>', '主机', 'localhost')
  .option('--provider <name>', 'LLM 供应商')
  .option('-m, --model <name>', '模型名')
  .option('-a, --api-key <key>', 'API Key')
  .option('-d, --data <path>', '数据目录', './.worldsea')
  .option('--no-guard', '禁用安全防护')
  .action(async (options) => {
    await initToolMetaRegistry()
    registerExecutionAdapterFactory({
      createNodeAdapter: () => new NodeExecutionAdapter(),
    })

    // 启动 HTTP+WS 服务器（原 serve.ts 逻辑 + worldsea-server 能力整合）
    await startServer({
      port: parseInt(options.port),
      host: options.host,
      provider: options.provider,
      model: options.model,
      apiKey: options.apiKey,
      data: options.data,
      guard: options.guard,
    })
  })

async function startServer(options: ServeOptions) {
  // 原 serve.ts 逻辑
  // 整合 worldsea-server 的 python-bridge / pty-manager / terminal-launcher
  // ...
}
```

## 5. worldsea-server 能力整合

### 5.1 整合清单

| worldsea-server 文件 | 迁移目标 | 整合方式 |
|------------------------|----------|----------|
| `routes/crawl.ts` | `apps/cli/src/commands/serve.ts` 内的 `/api/crawl` 路由 | 调用 CLI 的 `crawl_tool` 工具 |
| `routes/convert.ts` | `apps/cli/src/commands/serve.ts` 内的 `/api/convert` 路由 | 调用 CLI 的 `doc_convert_tool` 工具 |
| `routes/vector-search.ts` | `apps/cli/src/commands/serve.ts` 内的 `/api/vector-search` 路由 | 调用 CLI 的 `vector_search` 工具 |
| `python-bridge.ts` | `apps/cli/src/commands/python-bridge.ts` | 直接迁移 |
| `python-services/` | `apps/cli/src/python-services/` | 直接迁移 |
| `pty-manager.ts` | `apps/cli/src/commands/pty-manager.ts` | 直接迁移（与 NodeExecutionAdapter 协同） |
| `terminal-launcher.ts` | `apps/cli/src/commands/terminal-launcher.ts` | 直接迁移 |
| `server.ts` | 合并到 `apps/cli/src/commands/serve.ts` | 路由整合 |

### 5.2 路由整合示例

```typescript
// apps/cli/src/commands/serve.ts（整合后）
async function startServer(options: ServeOptions) {
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`)

    // 原有路由
    if (url.pathname === '/health') return handleHealth(res)
    if (url.pathname === '/api/capabilities') return handleCapabilities(res)
    if (url.pathname.startsWith('/api/tools/')) return handleToolCall(req, res, url)

    // 整合 worldsea-server 路由
    if (url.pathname === '/api/crawl') return handleCrawl(req, res)
    if (url.pathname === '/api/convert') return handleConvert(req, res)
    if (url.pathname === '/api/vector-search') return handleVectorSearch(req, res)
  })

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })
  // ... WS 逻辑
}
```

## 6. 迁移步骤

```
Step C1: 创建 apps/cli/ 目录骨架与 package.json
Step C2: 迁移 worldsea-agent/bin/cli.mjs 到 apps/cli/src/bin/
Step C3: 迁移 worldsea-agent/src/cli/ 到 apps/cli/src/（commands/stores/context 等）
Step C4: 拆分 cli/index.ts 为 commands/chat.ts + commands/serve.ts + index.ts
Step C5: 迁移 worldsea-agent/src/execution/node-adapter.ts 到 apps/cli/src/execution/
Step C6: 创建 src/index.ts（commander 主入口，注册 ExecutionAdapter）
Step C7: 迁移 worldsea-server/ 能力到 apps/cli/src/commands/
         - python-bridge.ts / python-services/ → apps/cli/src/commands/
         - pty-manager.ts → apps/cli/src/commands/
         - terminal-launcher.ts → apps/cli/src/commands/
         - routes/*.ts → 整合到 serve.ts
Step C8: 配置 apps/cli/tsconfig.json + tsconfig.cli.json
Step C9: 验证 apps/cli 独立 `worldsea --help` 通过
Step C10: 验证 apps/cli 独立 `worldsea chat` 启动通过
Step C11: 验证 apps/cli 独立 `worldsea serve` 启动通过
Step C12: 验证 Web 端通过 WS 连接 CLI serve 正常
Step C13: 删除 worldsea-server/ 目录
Step C14: 删除 worldsea-agent/ 目录（已拆分到 apps/cli 与 packages/agent-runtime）
```

## 7. 验证清单

- [ ] `apps/cli/package.json` 无 `vue` / `pinia` / `naive-ui` 依赖
- [ ] `apps/cli/package.json` 无 `@tauri-apps/*` 依赖
- [ ] `apps/cli/src/` 中无 `import vue` 或 Vue 组件
- [ ] `apps/cli/src/` 中无 `import @tauri-apps/api`
- [ ] `worldsea --help` 正常显示
- [ ] `worldsea chat` 能启动交互式对话
- [ ] `worldsea serve` 能启动 HTTP+WS 服务器
- [ ] Web 端通过 `ws://localhost:3100` 连接 CLI serve 正常
- [ ] CLI serve 的 `/api/crawl` / `/api/convert` / `/api/vector-search` 路由正常
- [ ] `worldsea-server/` 目录已删除
- [ ] `worldsea-agent/` 目录已删除（剩余部分已迁出）
