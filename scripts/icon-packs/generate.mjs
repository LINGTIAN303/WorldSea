/**
 * 从 @iconify-json 包生成精选图标包 TS 数据。
 * 只处理 manifest.mjs 中列出的语义图标；生成结果入库，运行时不需要 Iconify 依赖。
 *
 * 用法：node scripts/icon-packs/generate.mjs
 * 缓存：scripts/icon-packs/.cache/（已 gitignore）
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PACKS, SEMANTIC } from './manifest.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const CACHE = join(ROOT, 'scripts/icon-packs/.cache')
const OUT = join(ROOT, 'packages/ui-kit/src/assets/iconPacks/generated')
mkdirSync(CACHE, { recursive: true })
mkdirSync(OUT, { recursive: true })

const SOURCES = {
  ph: 'https://phosphoricons.com/',
  'ph-thin': 'https://phosphoricons.com/',
  'ph-light': 'https://phosphoricons.com/',
  'ph-bold': 'https://phosphoricons.com/',
  'sl-freehand': 'https://icon-sets.iconify.design/streamline-freehand/',
  'sl-plump': 'https://icon-sets.iconify.design/streamline-plump/',
  'sl-plump-remix': 'https://icon-sets.iconify.design/streamline-plump/',
  'sl-plump-solid': 'https://icon-sets.iconify.design/streamline-plump/',
  'sl-sharp': 'https://icon-sets.iconify.design/streamline-sharp/',
  'sl-sharp-remix': 'https://icon-sets.iconify.design/streamline-sharp/',
  'sl-sharp-solid': 'https://icon-sets.iconify.design/streamline-sharp/',
  'sl-cyber': 'https://icon-sets.iconify.design/streamline-cyber/',
  'sl-pixel': 'https://icon-sets.iconify.design/streamline-pixel/',
  gi: 'https://game-icons.net/',
  'ip-color': 'https://icon-sets.iconify.design/icon-park/',
  'ip-twotone': 'https://icon-sets.iconify.design/icon-park-twotone/',
  'solar-broken': 'https://icon-sets.iconify.design/solar/',
  'solar-duotone': 'https://icon-sets.iconify.design/solar/',
  'solar-linear': 'https://icon-sets.iconify.design/solar/',
  'solar-bold': 'https://icon-sets.iconify.design/solar/',
  'solar-outline': 'https://icon-sets.iconify.design/solar/',
  'solar-bold-duotone': 'https://icon-sets.iconify.design/solar/',
  pixel: 'https://pixelarticons.com/',
}

const packageCache = new Map()

async function loadPackage(pkg) {
  if (packageCache.has(pkg)) return packageCache.get(pkg)
  const dir = join(CACHE, pkg)
  const file = join(dir, 'package', 'icons.json')
  if (!existsSync(file)) {
    const meta = await (await fetch(`https://registry.npmjs.org/@iconify-json%2F${pkg}`)).json()
    const version = meta['dist-tags']?.latest
    if (!version) throw new Error(`找不到 @iconify-json/${pkg}`)
    const tarball = meta.versions[version].dist.tarball
    const tgz = join(CACHE, `${pkg}.tgz`)
    writeFileSync(tgz, new Uint8Array(await (await fetch(tarball)).arrayBuffer()))
    mkdirSync(dir, { recursive: true })
    execFileSync('tar', ['--force-local', '-xzf', tgz.replace(/\\/g, '/'), '-C', dir.replace(/\\/g, '/')])
  }
  const data = JSON.parse(readFileSync(file, 'utf8'))
  packageCache.set(pkg, data)
  return data
}

function findIcon(data, name) {
  const def = data.icons?.[name] ?? (data.aliases?.[name] ? data.icons?.[data.aliases[name].parent] : null)
  if (!def) return null
  return {
    width: def.width ?? data.width ?? 24,
    height: def.height ?? data.height ?? 24,
    body: def.body,
  }
}

function uniqueBody(packId, name, body) {
  if (/<script|<foreignObject|on\w+\s*=/i.test(body)) return null
  const prefix = `${packId}-${name}`.replace(/[^a-zA-Z0-9_-]/g, '-')
  return body
    .replace(/id="([^"]+)"/g, `id="${prefix}-$1"`)
    .replace(/url\((?:'|")?#([^)'"]+)(?:'|")?\)/g, `url(#${prefix}-$1)`)
}

function camel(id) {
  return id.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())
}

function packConst(pack) {
  return `${camel(pack.id)}Pack`
}

function lineForIcon(packId, localName, meta, def) {
  const body = uniqueBody(packId, localName, def.body)
  if (!body) return null
  return `    ${JSON.stringify(localName)}: { name: ${JSON.stringify(localName)}, label: ${JSON.stringify(meta.label)}, keywords: ${JSON.stringify(meta.keywords)}, domains: ${JSON.stringify(meta.domains)}, width: ${def.width}, height: ${def.height}, body: ${JSON.stringify(body)} },`
}

const generated = []

for (const pack of PACKS) {
  const data = await loadPackage(pack.package)
  const suffix = pack.suffix ?? ''
  const lines = []
  const used = new Set()

  for (const semantic of SEMANTIC) {
    const candidates = pack.aliases?.[semantic.key] ?? [semantic.key]
    let chosen = null
    for (const candidate of candidates) {
      const def = findIcon(data, `${candidate}${suffix}`)
      if (def) { chosen = { localName: `${candidate}${suffix}`, def }; break }
    }
    if (!chosen || used.has(chosen.localName)) continue
    const line = lineForIcon(pack.id, chosen.localName, semantic, chosen.def)
    if (!line) continue
    used.add(chosen.localName)
    lines.push(line)
  }

  for (const [name, label, keywords, domains] of pack.extras ?? []) {
    if (used.has(name)) continue
    const def = findIcon(data, name)
    if (!def) continue
    const line = lineForIcon(pack.id, name, { label, keywords, domains }, def)
    if (!line) continue
    used.add(name)
    lines.push(line)
  }

  if (lines.length < 8) console.warn(`[icon-packs] ${pack.id} 只生成 ${lines.length} 个图标，请检查 aliases`)

  const content = `import type { IconPackDef } from '../types'

export const ${packConst(pack)}: IconPackDef = {
  id: ${JSON.stringify(pack.id)},
  label: ${JSON.stringify(pack.label)},
  style: ${JSON.stringify(pack.style)},
  license: ${JSON.stringify(pack.license)},
  source: ${JSON.stringify(SOURCES[pack.id] ?? '')},
  colorMode: ${JSON.stringify(pack.colorMode)},
  icons: {
${lines.join('\n')}
  },
}
`
  writeFileSync(join(OUT, `${pack.id}.ts`), content, 'utf8')
  generated.push(pack)
  console.log(`[icon-packs] ${pack.id}: ${lines.length}`)
}

const imports = generated.map(pack => `import { ${packConst(pack)} } from './${pack.id}'`).join('\n')
const list = generated.map(pack => `  ${packConst(pack)},`).join('\n')
const index = `${imports}\n\nimport type { IconPackDef } from '../types'\n\nexport const GENERATED_ICON_PACKS: IconPackDef[] = [\n${list}\n]\n`
writeFileSync(join(OUT, 'index.ts'), index, 'utf8')
console.log(`[icon-packs] wrote ${generated.length} packs`)
