/**
 * 多文件栏会话级状态（2026-09-07，模块单例）：
 * 右栏文件 Tab（PreviewPanel）随五 Tab 切换 v-else-if 卸载重挂——tabs/activePath/
 * 脏标记/编辑缓冲必须落在组件外才不丢（切 Tab 回来 tab 与未保存缓冲都还在）。
 * 仅「拥有者」实例（PreviewPanel 传 owns-tabs 的 ProjectFilesPanel）读写；
 * 左栏（SessionSidebar，external 模式）实例恒不写入。
 */
import { reactive } from 'vue'
import type { FsNode } from './FileTreeBrowser.vue'

export const fileTabsState = reactive({
  tabs: [] as FsNode[],
  activePath: null as string | null,
  /** 各 tab 脏标记（FilePreview dirty-change 汇聚；tab 脏点数据源） */
  dirtyPaths: new Set<string>(),
  /** 编辑缓冲（path → 未保存内容）：进入编辑时恢复，保存/放弃时移除 */
  buffers: new Map<string, string>(),
})

/** 会话切换（rootPath 变化）时清空，避免串会话文件 */
export function resetFileTabs(): void {
  fileTabsState.tabs = []
  fileTabsState.activePath = null
  fileTabsState.dirtyPaths.clear()
  fileTabsState.buffers.clear()
}
