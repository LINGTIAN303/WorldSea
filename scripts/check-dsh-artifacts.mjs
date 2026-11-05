#!/usr/bin/env node
/**
 * dsh 产物新鲜度门禁：`dsh/` 源码改了，对应包的 `lib/` 产物必须重建过。
 *
 * 为什么要有这道门（连续三次同类事故，每次代价都是「用户白跑一趟真机」）：
 * - SSE 批：改了 `src/` 没重建，页面仍跑旧 `lib/client.js`（该批走查两轮判失败才发现）。
 * - H1 批第一轮：同上，登录用的还是无 `oauthCallbackOrigin` 的旧产物 → 点击无反应。
 * - H1 批第二波：改用 `pnpm --filter … bundle` 单包重建，**绕过官方构建脚本** →
 *   `DSH_CLIENT_VERSION` 没有被 define 注入 → 运行时抛 `carries no DSH_CLIENT_VERSION`。
 *
 * 判据（三个都必须过）：
 * 1. **新鲜度**：包内 `src/**`（或 `tsdown.config.ts` / `package.json`）的 mtime 不得晚于该包
 *    任一产物入口（`lib/index.js`、`lib/client.js`）。晚则报「源码改了未重建」。
 * 2. **版本内联**：客户端产物（`lib/client.js`）不得残留裸 `process.env.DSH_CLIENT_VERSION`
 *    （那意味着 define 没生效，运行时取到 undefined）。宿主产物同样检查。
 * 3. **版本非空**：若产物声明了 `DSH_CLIENT_VERSION` 注入点，必须能读到版本字面量（非空串）。
 *
 * 豁免：包内没有任何产物（纯类型包）时跳过；`node_modules`、`lib` 自身不参与 mtime 比较。
 * 逃生口：`SKIP_DSH_ARTIFACT_FRESHNESS=1`（仅在明知产物由别处产出时使用）。
 *
 * 用法：node scripts/check-dsh-artifacts.mjs   （或 pnpm artifacts:check）
 * 退出码：通过 0，失败 1。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const REPO = process.cwd()
const DSH = path.join(REPO, 'dsh')
const SKIP_DIRS = new Set(['node_modules', 'lib', 'tests', '__tests__', '.git', 'locale', 'assets'])

/**
 * 工作树里该路径下**有未提交改动**的文件（相对仓库根）。
 *
 * 只把「内容确实变了」当作「源码比产物新」的证据：checkout / merge 会刷新 mtime
 * 而内容不变，仅凭时间会在每次合并后误报整棵树。非 git 工作区或 git 不可用时退化为
 * 「不提供证据」（返回空），此时只保留版本内联判据——宁可少报也不误报。
 */
function dirtyPathsUnder(relativePath) {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', relativePath], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.split('\n').map(line => line.slice(3).trim()).filter(Boolean)
  } catch {
    return []
  }
}

if (process.env.SKIP_DSH_ARTIFACT_FRESHNESS === '1') {
  console.log('== dsh 产物新鲜度 ==\n— 已按 SKIP_DSH_ARTIFACT_FRESHNESS=1 跳过')
  process.exit(0)
}

if (!existsSync(DSH)) {
  console.log('== dsh 产物新鲜度 ==\n— 无 dsh/ 树，跳过')
  process.exit(0)
}

/** 包的产物入口候选（相对包目录）。 */
const ARTIFACT_ENTRIES = ['lib/index.js', 'lib/client.js']

/** 递归取一个目录下所有文件的 mtime 最大值（跳过 SKIP_DIRS）。 */
function newestSourceMtime(dir) {
  let newest = 0
  const walk = (current) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(path.join(current, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      if (!/\.(ts|tsx|mts|cts)$/.test(entry.name)) continue
      try {
        const { mtimeMs } = statSync(path.join(current, entry.name))
        if (mtimeMs > newest) newest = mtimeMs
      } catch {
        // 并发删除的文件不参与判定
      }
    }
  }
  walk(dir)
  return newest
}

/** 收集 dsh/packages 下带产物的包。 */
function collectPackages() {
  const groups = path.join(DSH, 'packages')
  const found = []
  let groupNames
  try {
    groupNames = readdirSync(groups, { withFileTypes: true }).filter(e => e.isDirectory())
  } catch {
    return found
  }
  for (const group of groupNames) {
    let packages
    try {
      packages = readdirSync(path.join(groups, group.name), { withFileTypes: true }).filter(e => e.isDirectory())
    } catch {
      continue
    }
    for (const pkg of packages) {
      const dir = path.join(groups, group.name, pkg.name)
      const present = ARTIFACT_ENTRIES.filter(rel => existsSync(path.join(dir, rel)))
      if (present.length === 0) continue
      found.push({ name: `${group.name}/${pkg.name}`, dir, entries: present })
    }
  }
  return found
}

/**
 * 读产物里是否残留裸 `process.env.DSH_CLIENT_VERSION`。
 * 命中意味着构建未注入 define —— 运行时该表达式取到的是 undefined。
 */
function hasRawVersionReference(file) {
  try {
    return readFileSync(file, 'utf8').includes('process.env.DSH_CLIENT_VERSION')
  } catch {
    return false
  }
}

const problems = []
let checked = 0
let skippedNoArtifact = 0

for (const pkg of collectPackages()) {
  checked++
  const srcDir = path.join(pkg.dir, 'src')
  const sources = []
  if (existsSync(srcDir)) {
    const newest = newestSourceMtime(srcDir)
    if (newest > 0) sources.push({ label: 'src', mtime: newest })
  }
  for (const extra of ['tsdown.config.ts', 'package.json']) {
    const file = path.join(pkg.dir, extra)
    if (!existsSync(file)) continue
    try {
      sources.push({ label: extra, mtime: statSync(file).mtimeMs })
    } catch {
      // 与上面同口径：读不到就不参与判定
    }
  }
  /** 最新的一处源码输入（label 用于报错时点名是哪一类文件变旧了）。 */
  const newestSource = sources.reduce((acc, cur) => (cur.mtime > acc.mtime ? cur : acc), { label: '—', mtime: 0 })
  // 判据 1：源码比任一产物入口新 → 该产物未重建。
  // 逐个比而非取全部产物的最小值/最大值：一个包可能只重建了一半（例如只重打了 lib/client.js，
  // lib/index.js 仍是旧的），取极值会把「部分陈旧」这种情况掩盖掉。
  //
  // **mtime 只在「源码内容确实与已提交版本不同」时才算数**：checkout / merge / rebase 会把整棵
  // 工作树的 mtime 刷成当前时间，而内容一个字没变——只看时间会在每次合并后误报整棵树（实测
  // 280 个提交合并后误报 460 项）。git 干净 = 工作树内容等于 HEAD，此时产物对应当前源码，
  // 时间差不构成证据。
  const relativePkg = path.relative(REPO, pkg.dir).split(path.sep).join('/')
  const dirtySources = dirtyPathsUnder(relativePkg)
  const sourceMoved = dirtySources.length > 0
  for (const rel of pkg.entries) {
    const mtime = statSync(path.join(pkg.dir, rel)).mtimeMs
    if (newestSource.mtime > mtime && sourceMoved) {
      problems.push(
        `${pkg.name}：${newestSource.label} 比产物 ${rel} 新（源码 ${new Date(newestSource.mtime).toLocaleString()} > ` +
          `产物 ${new Date(mtime).toLocaleString()}）且该包源码有未提交改动 → 需重建该包产物`,
      )
    }
  }

  // 判据 2 + 3：版本内联
  for (const rel of pkg.entries) {
    const file = path.join(pkg.dir, rel)
    if (hasRawVersionReference(file)) {
      problems.push(
        `${pkg.name}：${rel} 残留裸 process.env.DSH_CLIENT_VERSION（构建未注入 define → 运行时为 undefined，` +
          `账号等功能会抛 carries no DSH_CLIENT_VERSION）；用 pnpm run build:artifacts 重建，勿用单包 bundle`,
      )
    }
  }
}

console.log('== dsh 产物新鲜度 ==')
console.log(`扫描带产物的包：${checked} 个（无产物的纯类型包已跳过 ${skippedNoArtifact}）`)

if (problems.length === 0) {
  console.log('✅ 产物与源码一致，且版本注入正常')
  process.exit(0)
}

console.log('')
for (const p of problems) console.log(`❌ ${p}`)
console.log('')
console.log(`— 违规 ${problems.length} 项`)
console.log('修法：cd dsh && pnpm run build:artifacts（不要用 pnpm --filter <pkg> bundle：它会绕过版本注入）')
process.exit(1)
