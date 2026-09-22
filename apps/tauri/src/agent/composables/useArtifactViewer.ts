/**
 * 外置原文查看器状态（UX-c）：模块级单例（同 useSessionBranch 面板显隐模式）
 *
 * 打开来源：工具行「查看全文」/ 截断标注 chip（经 view-artifact 事件链上抛）。
 * 取回实现见 `ArtifactViewer.vue`（`memory_read_raw` 分片）。
 */
import { ref } from 'vue'

/** 当前查看的内容坐标（null = 关闭） */
const viewerHash = ref<string | null>(null)

export function openArtifactViewer(hash: string): void {
  if (!hash) return
  viewerHash.value = hash
}

export function closeArtifactViewer(): void {
  viewerHash.value = null
}

export function useArtifactViewer() {
  return { viewerHash, openArtifactViewer, closeArtifactViewer }
}
