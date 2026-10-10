import { rmSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

// 2026-10-11 刷新：路径对齐现结构（壳=apps/tauri · 安装器=apps/installer · WASM=仓根两包）；
// 移除旧世界路径（worldsea-agent / worldsea-server / 根 src-tauri）。
const light = [
  { path: 'apps/tauri/dist', reason: '工作台前端构建输出', rebuild: 'cd apps/tauri && pnpm build' },
  { path: 'apps/tauri/workspace-dist', reason: '产品域（工作台窗）产物', rebuild: 'cd apps/tauri && node node_modules/vite/bin/vite.js build --config workspace/vite.config.ts' },
  { path: 'apps/tauri/dist-stats.html', reason: 'chunk 可视化报告（build 时生成）', rebuild: '随 build 再生成' },
  { path: 'node_modules/.cache', reason: 'Vite/工具缓存', rebuild: '自动重建' },
]

const TIERS = {
  light: {
    label: '轻量清理',
    desc: '前端构建产物与工具缓存（可随时重建）',
    targets: light,
  },
  deep: {
    label: '深度清理',
    desc: '含 Rust/WASM 编译缓存（重建需数分钟起）',
    targets: [
      ...light,
      { path: 'apps/tauri/src-tauri/target', reason: '壳（Tauri）编译缓存', rebuild: 'cargo build --offline（全量重编）' },
      { path: 'apps/installer/src-tauri/target', reason: '安装器编译缓存', rebuild: 'cd apps/installer && pnpm tauri:build' },
      { path: 'worldsea-core/target', reason: 'Core WASM 编译缓存', rebuild: 'pnpm build:core' },
      { path: 'tactical-engine/target', reason: '战术引擎 WASM 编译缓存', rebuild: 'pnpm build:wasm' },
    ],
  },
  full: {
    label: '完全清理',
    desc: '含 node_modules 与代码生成物（需完整重建）',
    targets: [
      ...light,
      { path: 'apps/tauri/src-tauri/target', reason: '壳（Tauri）编译缓存', rebuild: 'cargo build --offline（全量重编）' },
      { path: 'apps/installer/src-tauri/target', reason: '安装器编译缓存', rebuild: 'cd apps/installer && pnpm tauri:build' },
      { path: 'worldsea-core/target', reason: 'Core WASM 编译缓存', rebuild: 'pnpm build:core' },
      { path: 'tactical-engine/target', reason: '战术引擎 WASM 编译缓存', rebuild: 'pnpm build:wasm' },
      { path: 'node_modules', reason: '主依赖（pnpm workspace）', rebuild: 'pnpm install' },
      { path: 'apps/tauri/node_modules', reason: '工作台依赖', rebuild: 'pnpm install' },
      { path: 'apps/dsh-plugin-worldsea/node_modules', reason: 'dsh 插件依赖', rebuild: 'pnpm install' },
      { path: 'apps/dsh-plugin-worldsea-console/node_modules', reason: 'dsh 插件依赖', rebuild: 'pnpm install' },
      { path: 'apps/installer/src-tauri/gen', reason: 'Tauri 代码生成物', rebuild: '随 tauri:build 再生成' },
      { path: 'apps/installer/src-tauri/payload', reason: '安装器打包载荷', rebuild: '随 tauri:build 再生成' },
      { path: 'worldsea-core/pkg', reason: 'Core WASM 产物（git 跟踪，删后需重建并提交）', rebuild: 'pnpm build:core' },
      { path: 'tactical-engine/pkg', reason: '战术引擎 WASM 产物（git 跟踪，删后需重建并提交）', rebuild: 'pnpm build:wasm' },
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
  console.log('  light  — 清理前端构建产物与缓存（默认）')
  console.log('  deep   — 额外清理 Rust/WASM 编译缓存（节省最多空间）')
  console.log('  full   — 额外清理 node_modules 与代码生成物（完全重置）')
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
