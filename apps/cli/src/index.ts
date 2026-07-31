/**
 * WorldSmith CLI 主入口（Phase 4 — serve 命令已实现）
 *
 * 用法：
 *   worldsmith serve [options]    启动 HTTP+WS 服务器（替代 worldsmith-server）
 *   worldsmith chat [options]     交互式对话（Phase 5 迁入）
 *   worldsmith --help
 */
import { Command } from 'commander'
import { createRequire } from 'node:module'
import { startServer } from './commands/serve'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')

const program = new Command()

program
  .name('worldsmith')
  .description('WorldSmith CLI — AI-powered worldbuilding assistant')
  .version(pkg.version)

// chat 子命令（Phase 5 迁入实际实现）
program
  .command('chat')
  .description('交互式对话（Phase 5 迁入）')
  .option('-p, --provider <name>', 'LLM provider', 'deepseek')
  .option('-m, --model <name>', 'Model ID', 'deepseek-chat')
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'Custom API base URL')
  .option('-d, --data <path>', 'Data directory', './.worldsmith-data')
  .action((_opts: unknown) => {
    console.log('[Phase 4] chat 命令将在 Phase 5 从 worldsmith-agent 迁入')
    console.log('当前可用：worldsmith serve, worldsmith --help, worldsmith --version')
  })
// serve 子命令（Phase 4 已实现）
program
  .command('serve')
  .description('启动 HTTP+WS 服务器（替代 worldsmith-server）')
  .option('-p, --port <number>', 'HTTP port', '3100')
  .option('-H, --host <addr>', 'Host', '127.0.0.1')
  .option('--provider <name>', 'LLM provider', 'deepseek')
  .option('-m, --model <name>', 'Model ID', 'deepseek-chat')
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'Custom API base URL')
  .option('-d, --data <path>', 'Data directory', './.worldsmith-data')
  .option('--no-guard', 'Disable safety guard')
  .option('--auth-token <token>', 'Auth token (default: dev, no auth)', 'dev')
  .action(async (opts: {
    port: string
    host: string
    provider: string
    model: string
    apiKey?: string
    baseUrl?: string
    data: string
    guard: boolean
    authToken: string
  }) => {
    try {
      await startServer({
        port: parseInt(opts.port, 10),
        host: opts.host,
        provider: opts.provider,
        model: opts.model,
        apiKey: opts.apiKey || '',
        baseUrl: opts.baseUrl,
        data: opts.data,
        guard: opts.guard,
        authToken: opts.authToken,
      })
    } catch (err) {
      console.error('[serve] 启动失败:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

program.parse()