import { computed, ref, watch, type Ref } from 'vue'
import { useResizable } from '../composables'

/**
 * 详情载体（L1）的共用外壳逻辑：标签页状态 + 宽度调节。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §十
 *
 * 抽屉与栏式整页共用一份——两个载体只差**容器**（遮罩浮层 vs 与列表同排分栏），
 * 而「当前在哪一页、能不能拖宽」不该各写一遍（1a 的四套字段控件就是各写一遍长出来的）。
 */
export interface DetailTab {
  id: string
  label: string
  icon?: string
}

export interface DetailChromeOptions {
  /** 载体实例的宽度持久化 id（抽屉与栏式分开记，互不覆盖） */
  panelId: string
  defaultWidth: number
  minWidth: number
  maxWidth?: number
  defaultTab?: string
  tabs: DetailTab[]
  resizeSide?: 'left' | 'right'
}

export interface DetailChrome {
  activeTab: Ref<string>
  switchTab: (tabId: string) => void
  panelWidth: Ref<number>
  onResizeStart: (e: MouseEvent) => void
}

export function useDetailChrome(
  options: DetailChromeOptions,
  onTabChange?: (tabId: string) => void,
): DetailChrome {
  const resizable = useResizable({
    panelId: options.panelId,
    defaultWidth: options.defaultWidth,
    minWidth: options.minWidth,
    maxWidth: options.maxWidth || undefined,
    side: options.resizeSide ?? 'left',
  })

  const activeTab = ref(options.defaultTab || (options.tabs.length > 0 ? options.tabs[0].id : ''))
  const firstTab = computed(() => (options.tabs.length > 0 ? options.tabs[0].id : ''))

  watch(() => options.defaultTab, (val) => {
    if (val) activeTab.value = val
  })
  // 标签集变了（切实体类型）要回到第一页，否则会停在已经不存在的 tab 上
  watch(firstTab, (val) => {
    if (val && !options.tabs.some(t => t.id === activeTab.value)) activeTab.value = val
  })

  function switchTab(tabId: string) {
    activeTab.value = tabId
    onTabChange?.(tabId)
  }

  return {
    activeTab,
    switchTab,
    panelWidth: resizable.width as Ref<number>,
    onResizeStart: resizable.onResizeStart,
  }
}
