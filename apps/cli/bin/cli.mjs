#!/usr/bin/env node
/**
 * WorldSmith CLI 入口（Phase 2 骨架）
 *
 * 用法：
 *   worldsmith chat [options]     交互式对话（Phase 4 迁入）
 *   worldsmith serve [options]    启动 HTTP+WS 服务器（Phase 4 迁入）
 *   worldsmith --help
 *
 * Phase 2 仅建立骨架，实际命令逻辑将在 Phase 4 从 worldsmith-agent 迁入。
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

// 使用 tsx 运行时注册 TypeScript 支持
register('tsx', pathToFileURL(import.meta.url))

// 导入并运行 CLI 主逻辑
import '../src/index.ts'
