import { ref, onMounted, onBeforeUnmount } from 'vue'
import type { GroupChatMessage } from '../types'

/** 右键菜单上下文选项 */
export interface CasualContextMenuOptions {
  /** 设置回复目标（点击"回复"时触发） */
  setReplyTarget?: (target: { messageId: string; name: string; text: string }) => void
}

/**
 * 休闲聊天右键菜单 composable
 *
 * 管理消息右键菜单的显示/隐藏、定位，以及"回复/复制"操作。
 * 通过 setReplyTarget 回调将回复目标同步给外部组件。
 */
export function useCasualContextMenu(options?: CasualContextMenuOptions) {
  const contextMenu = ref<{ visible: boolean; x: number; y: number; msg: GroupChatMessage | null }>({
    visible: false, x: 0, y: 0, msg: null,
  })

  /** 消息右键时触发：定位并显示菜单 */
  function onMsgContextMenu(payload: { event: MouseEvent; msg: GroupChatMessage }): void {
    payload.event.preventDefault()
    contextMenu.value = {
      visible: true,
      x: Math.min(payload.event.clientX, window.innerWidth - 160),
      y: Math.min(payload.event.clientY, window.innerHeight - 80),
      msg: payload.msg,
    }
  }

  /** 关闭菜单 */
  function closeContextMenu(): void {
    contextMenu.value.visible = false
  }

  /** 点击"回复"：设置回复目标后关闭菜单 */
  function onContextReply(): void {
    const msg = contextMenu.value.msg
    if (msg) {
      options?.setReplyTarget?.({
        messageId: msg.id,
        name: msg.speakerName || '用户',
        text: msg.content.slice(0, 60),
      })
    }
    closeContextMenu()
  }

  /** 点击"复制"：复制消息内容到剪贴板 */
  async function onContextCopy(): Promise<void> {
    const msg = contextMenu.value.msg
    if (msg) {
      await navigator.clipboard.writeText(msg.content)
    }
    closeContextMenu()
  }

  // 全局点击监听：点击菜单外部时关闭菜单
  onMounted(() => {
    document.addEventListener('click', closeContextMenu)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('click', closeContextMenu)
  })

  return {
    contextMenu,
    onMsgContextMenu,
    closeContextMenu,
    onContextReply,
    onContextCopy,
  }
}
