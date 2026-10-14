/**
 * 多文件栏会话级状态（2026-09-07，模块单例）：
 * 现存唯一消费方 = FilePreview（只读写 buffers——编辑缓冲跨实例保活）。
 * tabs/activePath/dirtyPaths 与 resetFileTabs 是 FileTabBar/ProjectFilesPanel（2026-10-14 死代码
 * 清理删除）时代的遗留面，暂保留以最小化本批边界；后续 notebook 需要多 Tab 时在此扩展。
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
