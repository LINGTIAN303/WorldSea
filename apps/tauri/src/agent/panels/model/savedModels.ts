/**
 * 已保存模型独立持久化集合（localStorage）
 *
 * 由「保存并测试连接」成功时写入；「可用模型」区消费此集合展示跨供应商已保存模型。
 * 独立于 runtime 合成，成为权威来源。
 */
export interface SavedModel {
  id: string
  mode: 'cloud' | 'local' | 'custom'
  providerId: string
  providerLabel: string
  modelId: string
  name: string
  modality: string
}

const KEY = 'worldsea_saved_models'

export function loadSavedModels(): SavedModel[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function persistSavedModels(list: SavedModel[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {}
}

/** 按 id 去重地新增一个已保存模型（同模型覆盖，其余保留） */
export function addSavedModel(model: SavedModel): void {
  const list = loadSavedModels().filter((m) => m.id !== model.id)
  list.unshift(model)
  persistSavedModels(list)
}