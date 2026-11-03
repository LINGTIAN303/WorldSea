#!/usr/bin/env node
/**
 * 统一门禁入口：一次跑完全部脚本级检查，任一失败即整体失败。
 *
 * 为什么要有这个入口：四条门禁各自独立（arch / fork / style / doc-links），
 * 此前全靠人记得手跑，导致基线 16 天未更新、积压 10 项红无人察觉。
 * 统一入口既给 git 钩子用，也给人手动调用。
 *
 * 用法：
 *   node scripts/gate.mjs              # 跑全部（四个检查，约 1.8 秒）
 *   node scripts/gate.mjs --list       # 只列出将要运行的检查
 *   node scripts/gate.mjs --verbose    # 通过时也打印子脚本输出
 *
 * 退出码：全部通过 0，任一失败 1；跳过项不影响退出码。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')

const CHECKS = [
  { name: '架构检查（模块登记/文件规模/Rust 依赖/TS 环/TS 边）', script: 'scripts/architecture/check.mjs' },
  { name: 'dsh fork 台账一致性', script: 'scripts/check-dsh-fork-ledger.mjs', needsGit: true },
  { name: '样式一致性（裸色值/阴影/滤镜计数）', script: 'scripts/style-conformance/check.mjs' },
  { name: '文档相对链接与绝对路径', script: 'scripts/check-doc-links.mjs' },
]

const args = process.argv.slice(2)

if (args.includes('--list')) {
  for (const c of CHECKS) console.log(`- ${c.name}  (${c.script})`)
  process.exit(0)
}

const verbose = args.includes('--verbose') || args.includes('-v')
// fork 台账靠 `git diff <基线提交>` 判定，浅克隆/源码包里取不到基线，跳过而非报错
const hasGit = existsSync(path.join(REPO, '.git'))
const results = []

for (const check of CHECKS) {
  const scriptAbs = path.join(REPO, check.script)
  if (!existsSync(scriptAbs)) {
    results.push({ ...check, status: 'skip', detail: '脚本不存在' })
    continue
  }
  if (check.needsGit && !hasGit) {
    results.push({ ...check, status: 'skip', detail: '非 git 工作区' })
    continue
  }
  const started = Date.now()
  const r = spawnSync(process.execPath, [scriptAbs], {
    cwd: REPO,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  results.push({
    ...check,
    status: r.status === 0 ? 'pass' : 'fail',
    ms: Date.now() - started,
    output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(),
  })
}

const failed = results.filter((r) => r.status === 'fail')

for (const r of results) {
  const tag = r.status === 'pass' ? '✓' : r.status === 'skip' ? '—' : '✗'
  const dur = r.ms === undefined ? '' : `  ${String(r.ms).padStart(4)}ms`
  console.log(`${tag} ${r.name}${dur}${r.detail ? `  (${r.detail})` : ''}`)
  // 失败必显输出；通过时仅 --verbose 展示，避免日常刷屏
  if (r.output && (r.status === 'fail' || verbose)) {
    console.log(r.output.split('\n').map((l) => `    ${l}`).join('\n'))
  }
}

console.log('')
if (failed.length === 0) {
  console.log(`门禁全过（${results.length} 项）`)
  process.exit(0)
}
console.log(`门禁失败 ${failed.length} 项：${failed.map((r) => r.name).join(' · ')}`)
process.exit(1)
