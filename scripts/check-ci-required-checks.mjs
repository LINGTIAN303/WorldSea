#!/usr/bin/env node
/**
 * 必需检查名一致性门禁：ci.yml 的 job 名必须与分支保护的 contexts 逐字一致。
 *
 * 为什么要有这道门：GitHub 的分支保护按**字符串**匹配必需检查。`contexts` 里写错
 * 一个字符，GitHub 就一直等一个永远不会出现的检查——PR 永久卡在 pending，
 * 而且报错只说「expected」，不说「你写错了」。改 job 名时没有任何东西提醒你
 * 同步改保护配置，这个失误只能靠人记住。
 *
 * 判据（两个方向都查，缺一不可）：
 * 1. 每个 context 都能在 ci.yml 里找到同名 job → 否则该检查永不到达，PR 卡死
 * 2. 每个 job 都出现在 contexts 里 → 否则该 job 跑红了也不会拦住合并
 *
 * 逃生口：SKIP_CI_NAME_CHECK=1；或环境里没有可用的 gh / 无管理员权限时
 * 自动降级为「只做静态检查」（校验 ci.yml 内部一致性），不阻塞本地提交。
 *
 * 用法：node scripts/check-ci-required-checks.mjs
 * 退出码：通过 0，失败 1，跳过 0。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOW = path.join(REPO, '.github', 'workflows', 'ci.yml')
const PROTECTED_BRANCH = process.env.CI_PROTECTED_BRANCH ?? 'main'
const REPO_SLUG = process.env.CI_REPO_SLUG ?? 'LINGTIAN303/WorldSea'

if (process.env.SKIP_CI_NAME_CHECK === '1') {
  console.log('— 已跳过（SKIP_CI_NAME_CHECK=1）')
  process.exit(0)
}

if (!existsSync(WORKFLOW)) {
  console.log(`✗ 找不到工作流文件：${path.relative(REPO, WORKFLOW)}`)
  process.exit(1)
}

/**
 * 从 ci.yml 抽 job 名。
 *
 * 不用 YAML 库：根目录 workspace 没有 yaml 依赖，为这一处引入解析器不划算。
 * 本文件的格式由我们自己维护，够用的最小解析即可——只认 `  <id>:`（job 定义，
 * 两空格缩进）与其下 `    name: <value>`（四空格缩进）。解析不出 name 时
 * GitHub 默认用 job id 作为检查名，这里照此实现。
 */
function parseJobNames(text) {
  const names = new Map()
  let curId = null
  let inJobs = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true
      continue
    }
    if (!inJobs) continue
    // 顶层键（无缩进）意味着 jobs 块结束
    if (/^\S/.test(line) && line.trim() !== '') break
    const jobMatch = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (jobMatch) {
      curId = jobMatch[1]
      // 还没读到 name 时，GitHub 用 job id 当检查名
      names.set(curId, curId)
      continue
    }
    const nameMatch = /^ {4}name:\s*(.+?)\s*$/.exec(line)
    if (nameMatch && curId) {
      names.set(curId, nameMatch[1].replace(/^['"]|['"]$/g, ''))
    }
  }
  return names
}

const jobNames = parseJobNames(readFileSync(WORKFLOW, 'utf8'))
if (jobNames.size === 0) {
  console.log('✗ 未能从 ci.yml 解析出任何 job——文件结构可能已变更，请检查解析逻辑')
  process.exit(1)
}

function readContexts() {
  try {
    const out = execFileSync(
      'gh',
      ['api', `repos/${REPO_SLUG}/branches/${PROTECTED_BRANCH}/protection/required_status_checks`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return JSON.parse(out).contexts ?? []
  } catch {
    return null
  }
}

const contexts = readContexts()

if (contexts === null) {
  // 没有 gh / 无管理员权限 / 分支无保护：降级为静态自检，不阻塞
  console.log('— 取不到分支保护配置（gh 不可用或无管理员权限），跳过一致性比对')
  console.log(`  ci.yml 中的检查名（${jobNames.size} 个）：`)
  for (const name of jobNames.values()) console.log(`    · ${name}`)
  process.exit(0)
}

const declared = new Set(jobNames.values())
const required = new Set(contexts)
const missingInYml = contexts.filter((c) => !declared.has(c))
const missingInProtection = [...declared].filter((n) => !required.has(n))

if (missingInYml.length === 0 && missingInProtection.length === 0) {
  console.log(`✓ 必需检查名一致（${contexts.length} 项，分支 ${PROTECTED_BRANCH}）`)
  process.exit(0)
}

if (missingInYml.length > 0) {
  console.log('✗ 分支保护要求了 ci.yml 中不存在的检查——这些 PR 会永久卡在 pending：')
  for (const c of missingInYml) console.log(`    · ${c}`)
  console.log('  ci.yml 现有检查名：')
  for (const n of declared) console.log(`    - ${n}`)
}
if (missingInProtection.length > 0) {
  console.log('✗ ci.yml 有检查未列入必需项——这些 job 失败不会拦住合并：')
  for (const n of missingInProtection) console.log(`    · ${n}`)
}
process.exit(1)
