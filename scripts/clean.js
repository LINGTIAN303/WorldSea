import { rmSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

const TIERS = {
  light: {
    label: '轻量清理',
    desc: '构建产物和缓存（可随时重建）',
    targets: [
      { path: 'dist', reason: 'Vite 构建输出', rebuild: 'pnpm build:web' },
      { path: 'worldsmith-agent/dist', reason: 'Agent 库构建输出', rebuild: 'pnpm install' },
      { path: 'node_modules/.cache', reason: 'Vite/工具缓存', rebuild: '自动重建' },
      { path: 'worldsmith-agent/node_modules/.cache', reason: 'Agent 缓存', rebuild: '自动重建' },
    ],
  },
  deep: {
    label: '深度清理',
    desc: '含 Rust 编译缓存（重建 WASM 需 2-5 分钟）',
    targets: [
      { path: 'dist', reason: 'Vite 构建输出', rebuild: 'pnpm build:web' },
      { path: 'worldsmith-agent/dist', reason: 'Agent 库构建输出', rebuild: 'pnpm install' },
      { path: 'node_modules/.cache', reason: 'Vite/工具缓存', rebuild: '自动重建' },
      { path: 'worldsmith-agent/node_modules/.cache', reason: 'Agent 缓存', rebuild: '自动重建' },
      { path: 'worldsmith-core/target', reason: 'Core WASM 编译缓存', rebuild: 'pnpm build:core' },
      { path: 'tactical-engine/target', reason: '战术引擎编译缓存', rebuild: 'pnpm build:wasm' },
      { path: 'src-tauri/target', reason: 'Tauri 桌面端编译缓存', rebuild: 'pnpm tauri:build' },
    ],
  },
  full: {
    label: '完全清理',
    desc: '含 node_modules（需 pnpm install 重建，约 1-3 分钟）',
    targets: [
      { path: 'dist', reason: 'Vite 构建输出', rebuild: 'pnpm build:web' },
      { path: 'worldsmith-agent/dist', reason: 'Agent 库构建输出', rebuild: 'pnpm install' },
      { path: 'node_modules', reason: '主项目依赖', rebuild: 'pnpm install' },
      { path: 'worldsmith-core/target', reason: 'Core WASM 编译缓存', rebuild: 'pnpm build:core' },
      { path: 'worldsmith-core/pkg', reason: 'Core WASM 产物（git 跟踪，删后需重建并提交）', rebuild: 'pnpm build:core' },
      { path: 'tactical-engine/target', reason: '战术引擎编译缓存', rebuild: 'pnpm build:wasm' },
      { path: 'tactical-engine/pkg', reason: '战术引擎 WASM 产物（git 跟踪，删后需重建并提交）', rebuild: 'pnpm build:wasm' },
      { path: 'src-tauri/target', reason: 'Tauri 桌面端编译缓存', rebuild: 'pnpm tauri:build' },
      { path: 'worldsmith-server/node_modules', reason: '服务端依赖（独立 npm 项目）', rebuild: 'cd worldsmith-server && npm install' },
      { path: 'worldsmith-agent/node_modules', reason: 'Agent 依赖（workspace 成员，随主项目安装）', rebuild: 'pnpm install' },
    ],
  },
}

function calcSize(dirPath) {
  if (!existsSync(dirPath)) return { size: 0, files: 0 }
  let totalSize = 0
  let totalFiles = 0
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dirPath, entry.name)
      try {
        if (entry.isDirectory()) {
          const sub = calcSize(full)
          totalSize += sub.size
          totalFiles += sub.files
        } else if (entry.isFile()) {
          totalSize += statSync(full).size
          totalFiles++
        }
      } catch {}
    }
  } catch {}
  return { size: totalSize, files: totalFiles }
}

function formatSize(bytes) {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB'
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return bytes + ' B'
}

function removeDir(dirPath) {
  if (!existsSync(dirPath)) return false
  if (dryRun) return true
  try {
    rmSync(dirPath, { recursive: true, force: true })
    return true
  } catch (e) {
    console.warn(`  ⚠ 部分文件无法删除（可能被占用）: ${e.message}`)
    return false
  }
}

const mode = process.argv[2] || 'light'
const dryRun = process.argv.includes('--dry-run')

if (!TIERS[mode]) {
  console.log('用法: node scripts/clean.js [light|deep|full]')
  console.log('')
  console.log('  light  — 清理构建产物和缓存（默认）')
  console.log('  deep   — 额外清理 Rust 编译缓存（节省最多空间）')
  console.log('  full   — 额外清理 node_modules（完全重置）')
  console.log('  --dry-run — 仅显示可回收空间，不实际删除')
  process.exit(0)
}

const tier = TIERS[mode]
console.log(`\n🧹 ${tier.label} — ${tier.desc}\n`)

let totalReclaimed = 0
let cleaned = 0
let skipped = 0

for (const target of tier.targets) {
  const full = join(ROOT, target.path)
  const { size, files } = calcSize(full)

  if (!existsSync(full)) {
    console.log(`  ⏭  ${target.path}  (不存在，跳过)`)
    skipped++
    continue
  }

  if (size === 0) {
    console.log(`  ⏭  ${target.path}  (空目录，跳过)`)
    skipped++
    continue
  }

  const ok = removeDir(full)
  if (dryRun) {
    console.log(`  🔍 ${target.path}  ${formatSize(size)}  ${files} 文件  [dry-run]`)
    totalReclaimed += size
    cleaned++
  } else if (ok) {
    console.log(`  ✅ ${target.path}  ${formatSize(size)}  ${files} 文件  → 重建: ${target.rebuild}`)
    totalReclaimed += size
    cleaned++
  } else {
    const remaining = calcSize(full)
    const freed = size - remaining.size
    totalReclaimed += freed
    cleaned++
    console.log(`  ⚠️  ${target.path}  释放 ${formatSize(freed)}/${formatSize(size)}  (部分文件被占用，重启后可再次清理)`)
  }
}

console.log('')
if (cleaned > 0) {
  const prefix = dryRun ? '🔍 预估可回收' : '✨ 清理完成: 释放'
  console.log(`${prefix} ${formatSize(totalReclaimed)}，${cleaned} 个目录`)
} else {
  console.log('✨ 无需清理，所有目标目录已为空或不存在')
}
if (skipped > 0) {
  console.log(`   跳过 ${skipped} 个目录`)
}
console.log('')
