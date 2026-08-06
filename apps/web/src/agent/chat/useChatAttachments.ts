/** useChatAttachments：聊天附件分类与 vision 提示构建（从 AgentChat.onInputSend 拆分，依赖注入解耦） */
import type { Ref } from 'vue'
import type { ImageAttachment, FileAttachment } from '@agent/index'
import { storeImages, modelSupportsVision } from '@agent/index'
import { useFileStore } from '@worldsmith/entity-core'

/** buildAttachments 的返回结果 */
export interface ChatAttachmentBuildResult {
  images: ImageAttachment[]
  files: FileAttachment[]
  userText: string
  visionHint: string | null
}

export interface UseChatAttachmentsOptions {
  /** 当前主模型 ID（useChatSettings.currentModelId，用于判断是否支持 vision） */
  currentModelId: Ref<string>
}

export function useChatAttachments(options: UseChatAttachmentsOptions) {
  const { currentModelId } = options

  /** 附件分类 + 文件持久化 + vision hint 构建（原 onInputSend 内联逻辑） */
  async function buildAttachments(text: string, rawAttachments: unknown[]): Promise<ChatAttachmentBuildResult> {
    const images: ImageAttachment[] = []
    const files: FileAttachment[] = []
    const fileStore = useFileStore()

    for (const att of rawAttachments) {
      const a = att as { type?: string; data?: string; mimeType?: string; name?: string; textContent?: string }
      if (a.type === 'image' && a.data && a.mimeType) {
        images.push({ data: a.data, mimeType: a.mimeType })
      } else if (a.textContent) {
        const name = a.name || 'file'
        const path = `/uploads/${name}`
        const content = a.textContent
        const size = new Blob([content]).size
        await fileStore.add(name, path, a.mimeType || 'text/plain', size, content)
        files.push({ name, content })
      }
    }

    if (images.length > 0 && !modelSupportsVision(currentModelId.value)) {
      const imageId = storeImages(images.map(img => ({ data: img.data, mimeType: img.mimeType })))
      const userText = text || '请分析这些图片'
      const visionHint = `用户发送了 ${images.length} 张图片（图片批次 ID: ${imageId}，30分钟内有效）。请使用 vision_analyze 工具来查看和分析这些图片，然后根据分析结果回答用户的问题。\n\n用户消息：${userText}`
      return { images, files, userText, visionHint }
    }

    return { images, files, userText: text || (images.length ? '请描述这张图片' : ''), visionHint: null }
  }

  return { buildAttachments }
}
