#!/usr/bin/env node
/**
 * dsh fork 台账门禁（D10 配套）：`dsh/` 相对 fork 基线的每一处改动都必须登记在台账
 * `docs/details/架构/dsh-fork台账.md`（第三节的 ```text 代码块）。
 *
 * 判据：
 * - `git diff <基线提交> -- dsh` 得到的每个文件 → 必须在台账里（缺失即报红，退出码 1）。
 *
 * 基线自 2026-11-13 起是「上次追版验收提交」（含已重放的 fork 改动），而非「干净上游树」。
 * 换树提交本身随 PR squash 被丢弃，进不了 main 历史；由此 diff 只覆盖「相对上次验收以来的
 * 新增改动」，第三节 13 条是完整的 fork 现状登记、不再是 diff 的子集。所以这里不做
 * 「台账条目过期」检查——它在当前基线下恒误报（13 条里永远只有刚改的那一两条在 diff 里）。
 * 代价：某条 fork 改动被误删时门禁不报警，靠追版重放核对与运行手册 F 系列步骤兜住。
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

console.log('== dsh fork 台账门禁 ==')
console.log(`基线：${base} ｜ 实际改动文件：${String(changed.length)} ｜ 台账条目：${String(ledgered.size)}`)
if (missing.length > 0) {
  fail(`以下改动未登记进台账：\n  - ${missing.join('\n  - ')}`)
}
console.log('✅ 改动与台账一致')
