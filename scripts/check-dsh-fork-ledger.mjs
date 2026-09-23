#!/usr/bin/env node
/**
 * dsh fork 台账门禁（D10 配套）：`dsh/` 相对 fork 基线的每一处改动都必须登记在台账
 * `docs/details/架构/dsh-fork台账.md`（第三节的 ```text 代码块）。
 *
 * 判据：
 * - `git diff <基线提交> -- dsh` 得到的每个文件 → 必须在台账里（缺失即报红，退出码 1）。
 * - 台账里登记但实际无差异的文件 → 警告（条目过期，需清理；不报红）。
 *
 * 用法：node scripts/check-dsh-fork-ledger.mjs   （或 pnpm fork:check）
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const LEDGER_PATH = 'docs/details/架构/dsh-fork台账.md'

function fail(message) {
  console.error(`❌ ${message}`)
  process.exit(1)
}

let ledger
try {
  ledger = readFileSync(LEDGER_PATH, 'utf8')
} catch (error) {
  fail(`读不到台账 ${LEDGER_PATH}：${String(error)}`)
}

const base = ledger.match(/基线提交[：:]\s*`?([0-9a-f]{7,40})`?/)?.[1]
if (base === undefined) fail('台账缺少「基线提交：<commit>」')
try {
  execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], { stdio: 'ignore' })
} catch {
  fail(`台账里的基线提交在本仓不存在：${base}`)
}

const block = ledger.match(/```text\n([\s\S]*?)```/)?.[1]
if (block === undefined) fail('台账缺少第三节的 ```text 代码块')

const ledgered = new Set(
  block
    .split('\n')
    .map(line => line.split('|')[0].trim())
    .filter(entry => entry.startsWith('dsh/')),
)

const changed = execFileSync('git', ['diff', '--name-only', base, '--', 'dsh'], { encoding: 'utf8' })
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean)

const missing = changed.filter(path => !ledgered.has(path))
const stale = [...ledgered].filter(path => !changed.includes(path))

console.log('== dsh fork 台账门禁 ==')
console.log(`基线：${base} ｜ 实际改动文件：${String(changed.length)} ｜ 台账条目：${String(ledgered.size)}`)
if (stale.length > 0) {
  console.warn(`⚠️ 台账条目过期（实际无差异，建议清理）：\n  - ${stale.join('\n  - ')}`)
}
if (missing.length > 0) {
  fail(`以下改动未登记进台账：\n  - ${missing.join('\n  - ')}`)
}
console.log('✅ 改动与台账一致')
