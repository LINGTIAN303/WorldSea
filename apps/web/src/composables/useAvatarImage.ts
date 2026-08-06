import { ref, watch, onScopeDispose, toValue, type Ref, type MaybeRefOrGetter } from 'vue'
import { isImageAvatar, isAvatarRef, getAvatarRefId } from '../ui/avatar'
import { getAvatarBlob } from './avatarStore'

/** 将 avatar 字段解析为图片 src（object URL 生命周期管理见文档），详细见 docs/details/注释/web/composables/useAvatarImage.md */
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
