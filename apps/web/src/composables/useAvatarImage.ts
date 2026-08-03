import { ref, watch, onScopeDispose, toValue, type Ref, type MaybeRefOrGetter } from 'vue'
import { isImageAvatar, isAvatarRef, getAvatarRefId } from '../ui/avatar'
import { getAvatarBlob } from './avatarStore'

/**
 * 将 avatar 字段（图片 URL/base64/`avatar://` 引用/文字）解析为可直接显示的图片 src
 *
 * - 直接图片（URL/base64）→ 原值
 * - 存储引用（avatar://xxx）→ 异步从 avatarStore 读 Blob → object URL
 * - 文字/空 → null（由 AvatarBadge 显示文字首字）
 *
 * object URL 生命周期管理：avatar 变化或 scope 销毁时 revoke，避免内存泄漏。
 *
 * 用法：`const src = useAvatarImage(() => persona.avatar)`，传给 AvatarBadge 的 src prop。
 */
export function useAvatarImage(
  avatar: MaybeRefOrGetter<string | null | undefined>,
): Ref<string | null> {
  const src = ref<string | null>(null)
  let currentUrl: string | null = null

  async function resolve(avatarVal: string | null | undefined): Promise<void> {
    // revoke 旧的 object URL
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl)
      currentUrl = null
    }

    if (!avatarVal) {
      src.value = null
      return
    }

    if (isAvatarRef(avatarVal)) {
      const id = getAvatarRefId(avatarVal)
      if (!id) { src.value = null; return }
      const blob = await getAvatarBlob(id)
      if (!blob) { src.value = null; return }
      currentUrl = URL.createObjectURL(blob)
      src.value = currentUrl
      return
    }

    if (isImageAvatar(avatarVal)) {
      src.value = avatarVal
      return
    }

    src.value = null
  }

  watch(() => toValue(avatar), (val) => { resolve(val) }, { immediate: true })

  onScopeDispose(() => {
    if (currentUrl) URL.revokeObjectURL(currentUrl)
  })

  return src
}
