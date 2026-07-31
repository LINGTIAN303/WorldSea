// move-agent-runtime.js — 将 worldsmith-agent/src 中端无关代码移动到 packages/agent-runtime/src
import { existsSync, mkdirSync, renameSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const src = join(root, 'worldsmith-agent', 'src')
const dst = join(root, 'packages', 'agent-runtime', 'src')

function moveDir(name) {
  const from = join(src, name)
  const to = join(dst, name)
  if (!existsSync(from)) {
    console.log(`SKIP (not found): ${name}`)
    return
  }
  mkdirSync(to, { recursive: true })
  // 如果目标目录已存在且非空，需要逐个移动
  const entries = readdirSync(from)
  for (const entry of entries) {
    renameSync(join(from, entry), join(to, entry))
  }
  // 删除空源目录
  try { require('fs').rmdirSync(from) } catch {}
  console.log(`Moved dir: ${name}`)
}

function moveFile(name) {
  const from = join(src, name)
  const to = join(dst, name)
  if (!existsSync(from)) {
    console.log(`SKIP (not found): ${name}`)
    return
  }
  mkdirSync(dirname(to), { recursive: true })
  renameSync(from, to)
  console.log(`Moved file: ${name}`)
}

// 移动端无关目录
const dirs = ['tools','skills','session','orchestrator','toolbus','providers','context','kb','embedding','group-chat','mcp','stores','utils','__tests__']
for (const d of dirs) moveDir(d)

// 移动端无关根文件
const files = ['agent.ts','bridge.ts','bridge-types.ts','governor.ts','governor-modules.ts','vite-env.d.ts']
for (const f of files) moveFile(f)

// 移动 execution/adapter.ts 和 execution/env.ts（保留 node-adapter/tauri-adapter/ws-adapter）
moveFile('execution/adapter.ts')
moveFile('execution/env.ts')

// 列出剩余文件
console.log('\n=== Remaining in worldsmith-agent/src ===')
function listFiles(dir, prefix = '') {
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      listFiles(fullPath, prefix + entry + '/')
    } else {
      console.log(prefix + entry)
    }
  }
}
listFiles(src)
