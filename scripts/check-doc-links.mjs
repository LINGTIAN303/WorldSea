/**
 * 文档相对链接校验器
 *
 * 用途：扫描 docs/ 下全部 .md，检查 `[文字](相对路径)` 形式的链接目标是否存在。
 * 背景：2026-09-11 全库核对发现 215 处断链，根因两类——
 *   ① 2026-08-25 crate 重组致 `crates/agent-runtime/src/...` 引用系统性过期；
 *   ② web→tauri 端收敛致已删前端组件路径失效。
 *   本文档库约定「文档变更必须同步索引」，链接有效性是其前置条件。
 *
 * 用法：
 *   node scripts/check-doc-links.mjs            # 扫描 docs/
 *   node scripts/check-doc-links.mjs docs/plans # 扫描指定子目录
 *
 * 注：Windows PowerShell 5.1 的管道默认按 ANSI 解码，重定向输出会出现中文乱码。
 *     需先执行 `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`，
 *     或直接在 Git Bash / 终端里运行。
 *
 * 输出三类：
 *   - 断链：相对链接解析后目标不存在
 *   - 绝对路径引用：`file:///...` 或 `/...` 开头（违反项目「禁用绝对路径」约定）
 *   - 疑似误报：形如 [说明](中文说明) 的纯文字括号，非真实链接
 *
 * 退出码（供 git 钩子与 CI 判定）：断链或绝对路径任一非零 → 1，否则 0。
 * 疑似误报不影响退出码。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')

/** 被扫描目录：默认 docs/，可由命令行参数覆盖 */
const targets = process.argv.slice(2)
const roots = (targets.length > 0 ? targets : ['docs']).map((t) => path.resolve(REPO, t))

/** 链接判定正则：捕获 [文字](目标) 中的目标 */
const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g

const missing = []
const absolute = []
const suspicious = []
let filesChecked = 0
let linksChecked = 0

/** 逐文件提取链接并校验 */
function checkFile(file) {
  filesChecked++
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return
  }

  let m
  LINK_RE.lastIndex = 0
  while ((m = LINK_RE.exec(text)) !== null) {
    let target = m[1].trim().replace(/^<|>$/g, '')
    // 跳过空目标、页内锚点、外部 URL
    if (!target || target.startsWith('#') || /^https?:/i.test(target)) continue

    // 绝对路径引用：单独归类（项目约定禁用）
    if (/^file:\/\//i.test(target) || target.startsWith('/')) {
      absolute.push(`${path.relative(REPO, file)} -> ${m[1]}`)
      continue
    }

    // 疑似误报：含空白或完全不含路径分隔符/扩展名，多为正文说明文字
    if (/\s/.test(target) || !/[/.]/.test(target)) {
      suspicious.push(`${path.relative(REPO, file)} -> ${m[1]}`)
      continue
    }

    // 剥离 #锚点 后按文件所在目录解析
    const hashIdx = target.indexOf('#')
    if (hashIdx >= 0) target = target.slice(0, hashIdx)
    if (!target) continue
    try {
      target = decodeURIComponent(target)
    } catch {
      /* 保留原样 */
    }

    linksChecked++
    const resolved = path.resolve(path.dirname(file), target)
    if (!fs.existsSync(resolved)) {
      missing.push(`${path.relative(REPO, file)} -> ${m[1]}`)
    }
  }
}

/** 递归遍历目录，跳过 node_modules 与隐藏目录 */
function walk(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      walk(p)
    } else if (e.name.endsWith('.md')) {
      checkFile(p)
    }
  }
}

for (const root of roots) walk(root)

// 按来源文档聚合断链数，定位问题最集中的文件
const byFile = new Map()
for (const item of missing) {
  const src = item.split(' -> ')[0]
  byFile.set(src, (byFile.get(src) ?? 0) + 1)
}
const ranked = [...byFile.entries()].sort((a, b) => b[1] - a[1])

const lines = []
lines.push(`扫描文件数: ${filesChecked}`)
lines.push(`相对链接数: ${linksChecked}`)
lines.push('')
lines.push(`断链: ${missing.length}`)
lines.push(`绝对路径引用: ${absolute.length}`)
lines.push(`疑似误报: ${suspicious.length}`)

if (ranked.length > 0) {
  lines.push('')
  lines.push('--- 断链数 Top 15 来源文档 ---')
  for (const [f, n] of ranked.slice(0, 15)) lines.push(`${String(n).padStart(4)}  ${f}`)
}

if (missing.length > 0) {
  lines.push('')
  lines.push('--- 断链明细 ---')
  lines.push(...missing)
}

if (absolute.length > 0) {
  lines.push('')
  lines.push('--- 绝对路径引用（违反约定） ---')
  lines.push(...absolute)
}

if (suspicious.length > 0) {
  lines.push('')
  lines.push('--- 疑似误报 ---')
  lines.push(...suspicious)
}

process.stdout.write(lines.join('\n') + '\n')

// 退出码供 git 钩子与 CI 判定：断链或绝对路径任一非零即失败。
// 约定与 arch:check / fork:check / style:check 一致——非零 = 不通过。
process.exit(missing.length > 0 || absolute.length > 0 ? 1 : 0)
