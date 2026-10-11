import JSZip from 'jszip'

export const WSFONT_VERSION = 1
export const WSFONT_MAGIC = 'wsfont'
export const WSFONT_EXTENSION = '.wsfont'

export interface WsFontVariant {
  file: string
  weight: number
  style: string
  format?: string
}

export interface WsFontManifest {
  version: number
  magic: string
  id: string
  family: string
  displayName: string
  category?: string
  license?: string
  author?: string
  description?: string
  tags?: string[]
  variants: WsFontVariant[]
  preview?: string
  createdAt: number
  updatedAt: number
}

export interface WsFontPackInput {
  id: string
  family: string
  displayName?: string
  category?: string
  license?: string
  author?: string
  description?: string
  tags?: string[]
  variants: Array<{
    data: ArrayBuffer | Uint8Array
    weight: number
    style: string
    format?: string
    fileName?: string
  }>
  preview?: ArrayBuffer | Uint8Array
}

function guessFormat(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'woff2') return 'woff2'
  if (ext === 'woff') return 'woff'
  if (ext === 'otf') return 'opentype'
  return 'truetype'
}

function variantFileName(family: string, weight: number, style: string, format: string): string {
  const wName: Record<number, string> = {
    100: 'thin', 200: 'extralight', 300: 'light', 400: 'regular',
    500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black',
  }
  const base = wName[weight] ?? String(weight)
  const suffix = style === 'italic' ? '-italic' : ''
  const ext = format === 'woff2' ? 'woff2' : format === 'woff' ? 'woff' : format === 'opentype' ? 'otf' : 'ttf'
  return `fonts/${family}-${base}${suffix}.${ext}`
}

export async function packWsFont(input: WsFontPackInput): Promise<Blob> {
  const zip = new JSZip()
  const now = Date.now()

  const variantEntries: WsFontVariant[] = []

  for (const v of input.variants) {
    const fmt = v.format ?? guessFormat(v.fileName ?? 'font.ttf')
    const file = v.fileName ?? variantFileName(input.family, v.weight, v.style, fmt)
    zip.file(file, v.data)
    variantEntries.push({ file, weight: v.weight, style: v.style, format: fmt })
  }

  if (input.preview) {
    zip.file('preview.png', input.preview)
  }

  const manifest: WsFontManifest = {
    version: WSFONT_VERSION,
    magic: WSFONT_MAGIC,
    id: input.id,
    family: input.family,
    displayName: input.displayName ?? input.family,
    category: input.category,
    license: input.license,
    author: input.author,
    description: input.description,
    tags: input.tags,
    variants: variantEntries,
    preview: input.preview ? 'preview.png' : undefined,
    createdAt: now,
    updatedAt: now,
  }

  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

function toArrayBuffer(source: Blob | ArrayBuffer | Uint8Array): Blob | ArrayBuffer {
  if (source instanceof Uint8Array) {
    return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer
  }
  return source
}

export async function unpackWsFont(source: Blob | ArrayBuffer | Uint8Array): Promise<{
  manifest: WsFontManifest
  files: Map<string, Uint8Array>
}> {
  const data = toArrayBuffer(source)

  const zip = await JSZip.loadAsync(data)
  const manifestStr = await zip.file('manifest.json')?.async('string')
  if (!manifestStr) throw new Error('Invalid .wsfont: missing manifest.json')

  const manifest: WsFontManifest = JSON.parse(manifestStr)
  if (manifest.magic !== WSFONT_MAGIC) throw new Error('Invalid .wsfont: bad magic')
  if (manifest.version > WSFONT_VERSION) throw new Error(`Unsupported .wsfont version: ${manifest.version}`)

  const files = new Map<string, Uint8Array>()
  const filePromises: Promise<void>[] = []

  zip.forEach((relativePath, file) => {
    if (file.dir || relativePath === 'manifest.json') return
    filePromises.push(
      file.async('uint8array').then(data => {
        files.set(relativePath, data)
      }),
    )
  })

  await Promise.all(filePromises)

  return { manifest, files }
}

export async function readWsFontManifest(source: Blob | ArrayBuffer | Uint8Array): Promise<WsFontManifest> {
  const data = toArrayBuffer(source)

  const zip = await JSZip.loadAsync(data)
  const manifestStr = await zip.file('manifest.json')?.async('string')
  if (!manifestStr) throw new Error('Invalid .wsfont: missing manifest.json')
  return JSON.parse(manifestStr)
}

export function isWsFontFile(fileName: string): boolean {
  return fileName.endsWith(WSFONT_EXTENSION)
}
