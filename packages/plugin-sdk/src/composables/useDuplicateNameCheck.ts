import { useEntityStore } from '@worldsmith/entity-core'
import { useDialog, toastWarn } from '@worldsmith/ui-kit'

export function useDuplicateNameCheck() {
  const entityStore = useEntityStore()
  const dialog = useDialog()

  function isDuplicateName(name: string, excludeId?: string, entityType?: string): boolean {
    if (!name.trim()) return false
    return entityStore.entities.some(
      e => e.name.trim().toLowerCase() === name.trim().toLowerCase()
        && e.id !== excludeId
        && (entityType ? e.type === entityType : true)
    )
  }

  async function checkAndConfirmName(name: string, excludeId?: string, entityType?: string): Promise<string | null> {
    if (!isDuplicateName(name, excludeId, entityType)) return name

    toastWarn(`名称「${name}」已存在，请使用其他名称`)

    const newName = await dialog.prompt(
      `名称「${name}」与已有实体重复，请输入新名称：`,
      '名称冲突',
      name
    )

    if (!newName || !newName.trim()) return null

    if (isDuplicateName(newName, excludeId, entityType)) {
      toastWarn(`名称「${newName}」也已存在，创建取消`)
      return null
    }

    return newName.trim()
  }

  return { isDuplicateName, checkAndConfirmName }
}
