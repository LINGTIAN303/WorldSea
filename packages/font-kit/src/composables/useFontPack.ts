import { ref, readonly, onScopeDispose, getCurrentScope } from 'vue'
import {
  packWsFont,
  unpackWsFont,
  readWsFontManifest,
  isWsFontFile,
  type WsFontPackInput,
  type WsFontManifest,
} from '../WsFontPack'
import {
  register,
  type FontSource,
} from '../FontRegistry'
import { loadFont } from '../FontLoader'

export type { WsFontPackInput, WsFontManifest }

export interface UseFontPackReturn {
  packing: ReturnType<typeof readonly<ReturnType<typeof ref<boolean>>>>
  unpacking: ReturnType<typeof readonly<ReturnType<typeof ref<boolean>>>>
  lastManifest: ReturnType<typeof readonly<ReturnType<typeof ref<WsFontManifest | null>>>>
  pack: (input: WsFontPackInput) => Promise<Blob>
  unpack: (source: Blob | ArrayBuffer | Uint8Array) => Promise<{ manifest: WsFontManifest; files: Map<string, Uint8Array> }>
  readManifest: (source: Blob | ArrayBuffer | Uint8Array) => Promise<WsFontManifest>
  installFromPack: (source: Blob | ArrayBuffer | Uint8Array) => Promise<WsFontManifest>
  isWsFont: (fileName: string) => boolean
}

export function useFontPack(): UseFontPackReturn {
  const packing = ref(false)
  const unpacking = ref(false)
  const lastManifest = ref<WsFontManifest | null>(null)

  if (getCurrentScope()) {
    onScopeDispose(() => {
      lastManifest.value = null
    })
  }

  async function pack(input: WsFontPackInput): Promise<Blob> {
    packing.value = true
    try {
      return await packWsFont(input)
    } finally {
      packing.value = false
    }
  }

  async function unpack(source: Blob | ArrayBuffer | Uint8Array): Promise<{ manifest: WsFontManifest; files: Map<string, Uint8Array> }> {
    unpacking.value = true
    try {
      const result = await unpackWsFont(source)
      lastManifest.value = result.manifest
      return result
    } finally {
      unpacking.value = false
    }
  }

  async function readManifest(source: Blob | ArrayBuffer | Uint8Array): Promise<WsFontManifest> {
    const m = await readWsFontManifest(source)
    lastManifest.value = m
    return m
  }

  async function installFromPack(source: Blob | ArrayBuffer | Uint8Array): Promise<WsFontManifest> {
    const { manifest, files } = await unpack(source)
    lastManifest.value = manifest

    for (const variant of manifest.variants) {
      const data = files.get(variant.file)
      if (!data) continue

      const source: FontSource = {
        type: 'buffer',
        buffer: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
        format: variant.format,
      }

      register({
        id: `${manifest.id}-${variant.weight}-${variant.style}`,
        family: manifest.family,
        weight: variant.weight,
        style: variant.style,
        source,
      })

      try {
        await loadFont(`${manifest.id}-${variant.weight}-${variant.style}`)
      } catch {}
    }

    return manifest
  }

  function isWsFont(fileName: string): boolean {
    return isWsFontFile(fileName)
  }

  return {
    packing: readonly(packing),
    unpacking: readonly(unpacking),
    lastManifest: readonly(lastManifest),
    pack,
    unpack,
    readManifest,
    installFromPack,
    isWsFont,
  }
}
