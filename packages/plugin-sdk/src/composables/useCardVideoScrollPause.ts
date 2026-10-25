/**
 * 卡片视频滚动暂停（2026-10-25 形象图批 C 走查追加）：网格滚动中暂停全部视频封面，
 * 停止滚动（150ms 防抖）后按各自策略恢复——20+ 视频卡同播的帧率缓冲。默认开
 * （settings.videoCoverPauseOnScroll），可在设置关闭。
 * 模块级单例：一个 window scroll 监听服务所有卡片视频（passive，滚动零开销路径）。
 */
import { ref } from 'vue'

const scrolling = ref(false)
let wheelTimer: ReturnType<typeof setTimeout> | undefined
let installed = false

function markScroll() {
  scrolling.value = true
  clearTimeout(wheelTimer)
  wheelTimer = setTimeout(() => {
    scrolling.value = false
  }, 150)
}

/** 惰性安装全局监听（首个视频封面卡片挂载时） */
export function useCardVideoScrollPause(): { scrolling: typeof scrolling } {
  if (!installed && typeof window !== 'undefined') {
    installed = true
    window.addEventListener('scroll', markScroll, { passive: true, capture: true })
  }
  return { scrolling }
}
