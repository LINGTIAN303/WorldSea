#!/usr/bin/env node
/** 样式一致性门禁：禁止在目标目录的样式块中新增硬编码颜色与阴影；存量以基线锁死。 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const BASELINE = resolve(ROOT, 'scripts/style-conformance/baseline.json')
const TARGETS = ['packages/ui-kit/src', 'apps/tauri/src']
const WHITELIST = ['packages/ui-kit/src/assets/', 'apps/tauri/src/assets/', '/graph/']
const RULES = {
  hex: /#[0-9a-fA-F]{3,8}\b/g,
  rgba: /rgba?\(/g,
  boxShadow: /box-shadow\s*:/g,
  backdropFilter: /backdrop-filter\s*:/g,
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (['node_modules', 'dist', 'workspace-dist', '__tests__', 'assets'].includes(name)) continue
      walk(full, out)
    } else if (name.endsWith('.vue') || name.endsWith('.css')) {
      out.push(full)
    }
  }
  return out
}

function styleSource(file, source) {
  if (file.endsWith('.css')) return source
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
}

// 消费表面契约的阴影/模糊是合法写法，不计入硬编码存量；带 ignore 标记的行视为视觉资产
function stripTokenized(css) {
  return css
    .split('\n')
    .filter((line) => !line.includes('style-conformance: ignore'))
    .join('\n')
    .replace(/box-shadow\s*:\s*[^;]*var\(--sf-[^;]*;/g, '')
    .replace(/backdrop-filter\s*:\s*[^;]*var\(--sf-[^;]*;/g, '')
}

const counts = { hex: 0, rgba: 0, boxShadow: 0, backdropFilter: 0 }
for (const target of TARGETS) {
  for (const file of walk(resolve(ROOT, target))) {
    const rel = relative(ROOT, file).replace(/\\/g, '/')
    if (WHITELIST.some((prefix) => `/${rel}`.includes(prefix))) continue
    const css = stripTokenized(styleSource(file, readFileSync(file, 'utf8')))
    for (const [key, re] of Object.entries(RULES)) counts[key] += (css.match(re) ?? []).length
  }
}

if (process.argv.includes('--write-baseline')) {
  writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`, 'utf8')
  console.log('style-conformance baseline ->', counts)
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  console.error('缺少基线：先运行 node scripts/style-conformance/check.mjs --write-baseline')
  process.exit(1)
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
let failed = false
for (const key of Object.keys(RULES)) {
  const current = counts[key]
  if (current > baseline[key]) {
    console.error(`✗ ${key}: ${current} > 基线 ${baseline[key]}`)
    failed = true
  } else {
    console.log(`✓ ${key}: ${current} / ${baseline[key]}`)
  }
}
process.exit(failed ? 1 : 0)
