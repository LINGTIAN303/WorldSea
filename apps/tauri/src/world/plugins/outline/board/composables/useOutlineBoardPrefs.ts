import { ref, watch } from 'vue'

/**
 * 大纲白板偏好（前端本地，跨会话保留）。
 *
 * 2026-10-18：容器编辑面板（BoardInspector）从「固定右上」改为**默认跟随选中卡片**
 * （贴卡片左侧、顶部平行），并作为可配置项暴露到设置 → 大纲。
 */
export type InspectorMode = 'follow' | 'fixed' | 'free'

const STORAGE_KEY = 'ws-outline-inspector-mode'

function readMode(): InspectorMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === 'fixed' || raw === 'free' ? raw : 'follow'
  } catch {
    return 'follow'
  }
}

// 模块级单例：同一窗口内「设置面板」与「白板」共享同一份状态，无需事件总线
const inspectorMode = ref<InspectorMode>(readMode())

watch(
  inspectorMode,
  (v) => {
    try {
      localStorage.setItem(STORAGE_KEY, v)
    } catch {
      /* 存储不可用（隐私模式等）：仅本会话生效，不阻断交互 */
    }
  },
  { flush: 'post' },
)

export function useOutlineBoardPrefs() {
  return { inspectorMode }
}
