import { useIconAssetStore, type IconAsset } from '@worldsea/entity-core'

export interface UploadIconResult {
  ok: boolean
  asset?: IconAsset
  globalAsset?: IconAsset
  reason?: string
}

/** 文件输入 → 项目图标（可选同时复制到全局）。校验与写盘在 store 内统一收口。 */
export async function uploadIconFile(
  file: File,
  options: { alsoGlobal?: boolean } = {},
): Promise<UploadIconResult> {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return { ok: false, reason: '读取文件失败' }
  }
  const store = useIconAssetStore()
  const added = await store.addProjectAsset({ fileName: file.name, bytes })
  if (!added.ok || !added.asset) return { ok: false, reason: added.reason ?? '图标上传失败' }
  if (!options.alsoGlobal) return { ok: true, asset: added.asset }
  const globalAsset = await store.promoteToGlobal(added.asset.id)
  return { ok: true, asset: added.asset, globalAsset: globalAsset ?? undefined }
}
