import { ref, watch, nextTick } from 'vue'
import { useGroupChatStore } from '../GroupChatStore'

/**
 * 消息列表滚动控制 composable
 *
 * 管理 messagesRef 引用、isAtBottom 状态，以及自动滚动到底部逻辑。
 * 当消息数量变化或流式内容更新时，若用户已在底部则自动跟随滚动。
 */
export function useMessageScroll() {
  const store = useGroupChatStore()

  const messagesRef = ref<HTMLDivElement>()
  const isAtBottom = ref(true)

  /** 滚动到消息列表底部 */
  function scrollToBottom(): void {
    const el = messagesRef.value
    if (el) el.scrollTop = el.scrollHeight
  }

  /** 滚动事件处理：根据位置更新 isAtBottom 状态 */
  function onMessagesScroll(): void {
    const el = messagesRef.value
    if (!el) return
    isAtBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 50
  }

  // 消息数量变化时，若用户在底部则自动滚动
  watch(() => store.casualMessages.length, () => {
    if (isAtBottom.value) {
      nextTick(scrollToBottom)
    }
  })

  // 流式内容更新时，若用户在底部则自动滚动
  watch(() => store.streamingAgents, () => {
    if (isAtBottom.value) {
      nextTick(scrollToBottom)
    }
  }, { deep: true })

  return {
    messagesRef,
    isAtBottom,
    scrollToBottom,
    onMessagesScroll,
  }
}
