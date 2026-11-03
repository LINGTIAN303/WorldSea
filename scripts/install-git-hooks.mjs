#!/usr/bin/env node
/**
 * 启用仓库自带的 git 钩子（.githooks/）。
 *
 * 为什么需要这一步：git 出于安全不执行版本库里的钩子，必须显式设置 core.hooksPath。
 * 新克隆仓库后跑一次 `pnpm hooks:install` 即可，之后 pre-commit / pre-push 自动生效。
 *
 * 用法：
 *   node scripts/install-git-hooks.mjs          # 启用
 *   node scripts/install-git-hooks.mjs --status # 查看是否已启用
 *   node scripts/install-git-hooks.mjs --remove # 撤销（恢复 git 默认钩子目录）
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const HOOKS_DIR = '.githooks'

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', ...opts }).trim()
}

function currentHooksPath() {
  try {
    return git(['config', '--get', 'core.hooksPath'])
  } catch {
    return ''
  }
}

const args = process.argv.slice(2)

if (args.includes('--status')) {
  const cur = currentHooksPath()
  if (cur === HOOKS_DIR) {
    console.log(`✓ 已启用（core.hooksPath = ${cur}）`)
    process.exit(0)
  }
  console.log(`— 未启用（core.hooksPath = ${cur || '(默认 .git/hooks)'}）`)
  console.log('  启用：pnpm hooks:install')
  process.exit(0)
}

if (args.includes('--remove')) {
  try {
    git(['config', '--unset', 'core.hooksPath'])
    console.log('✓ 已撤销 core.hooksPath，恢复 git 默认钩子目录')
  } catch {
    console.log('— 本来就没有设置 core.hooksPath')
  }
  process.exit(0)
}

// 前置检查：必须在 git 仓库内
try {
  git(['rev-parse', '--git-dir'])
} catch {
  console.error('✗ 当前目录不是 git 仓库')
  process.exit(1)
}

const hooksAbs = path.join(REPO, HOOKS_DIR)
if (!existsSync(hooksAbs)) {
  console.error(`✗ 找不到钩子目录 ${HOOKS_DIR}/`)
  process.exit(1)
}

// 钩子文件需可执行位（Windows 上 git 自己处理，Unix 上必须有）
for (const name of ['pre-commit', 'pre-push']) {
  const file = path.join(hooksAbs, name)
  if (existsSync(file)) {
    try { chmodSync(file, 0o755) } catch { /* Windows 无 chmod，忽略 */ }
  }
}

git(['config', 'core.hooksPath', HOOKS_DIR])
console.log(`✓ 已启用 core.hooksPath = ${HOOKS_DIR}`)
console.log('  pre-commit：架构 / fork 台账 / 样式 / 文档链接（约 1.8 秒）')
console.log('  pre-push  ：以上四项 + vue-tsc 类型检查（约 1 分钟）')
console.log('  临时绕过  ：SKIP_GATES=1 git commit ...')
