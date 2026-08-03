/**
 * 消息导出为图片/GIF 的 composable（共享层）
 *
 * 从 apps/web/src/agent/bubbles/useMessageExport.ts 迁移。
 * 端解耦：`persona`（字体细节）与 `enterAnimation`（入场动画）通过
 * `useAgentUiDeps()` 注入式获取，不再直接依赖 Web 端 usePersonaFont。
 */
import { useAgentUiDeps } from '@worldsmith/shared-composables/agent/deps'
import { renderText, toBlob, renderAnimatedText } from '@worldsmith/font-kit'
import { encodeGif } from '@worldsmith/motion-kit'
import { stripJsonBlocks } from './useMarkdownRender'

/**
 * @param getContent 返回当前消息的原始 content（可能含 JSON block）
 */
export function useMessageExport(getContent: () => string | undefined) {
  const { persona, enterAnimation } = useAgentUiDeps()

  /** 导出当前消息文本为 PNG 图片 */
  async function onExportImage() {
    const content = getContent()
    if (!content) return
    try {
      const text = stripJsonBlocks(content.trim())
      const plainText = text.replace(/<[^>]*>/g, '').trim()
      if (!plainText) return

      const p = persona.value
      const { canvas } = renderText({
        text: plainText.slice(0, 500),
        fontFamily: p.fontFamily,
        fontSize: 16 * p.sizeScale,
        fontWeight: p.weightDefault,
        color: '#e0e0e0',
        backgroundColor: '#1a1a2e',
        maxWidth: 480,
        padding: 20,
      })

      const blob = await toBlob(canvas, 'png')
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `agent-msg-${Date.now()}.png`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('导出图片失败:', err)
    }
  }

  /** 导出当前消息文本为 GIF 动画（按入场动画效果） */
  async function onExportGif() {
    const content = getContent()
    if (!content) return
    try {
      const text = stripJsonBlocks(content.trim())
      const plainText = text.replace(/<[^>]*>/g, '').trim()
      if (!plainText) return

      const p = persona.value
      const result = renderAnimatedText({
        text: plainText.slice(0, 200),
        effect: enterAnimation.value,
        renderOptions: {
          fontFamily: p.fontFamily,
          fontSize: 16 * p.sizeScale,
          fontWeight: p.weightDefault,
          color: '#e0e0e0',
          backgroundColor: '#1a1a2e',
          maxWidth: 480,
          padding: 20,
        },
        duration: 2000,
        fps: 15,
      })

      const gifFrames = result.frames.map(frame => ({
        width: frame.width,
        height: frame.height,
        data: frame.imageData.data,
        delay: frame.delay,
      }))

      const gifData = encodeGif({ width: result.width, height: result.height, frames: gifFrames, loop: 0 })
      const gifBlob = new Blob([Uint8Array.from(gifData)], { type: 'image/gif' })
      const url = URL.createObjectURL(gifBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `agent-anim-${Date.now()}.gif`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('导出GIF失败:', err)
    }
  }

  return { onExportImage, onExportGif }
}