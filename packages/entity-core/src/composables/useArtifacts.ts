import { computed } from 'vue'
import { useArtifactStore } from '../stores/artifactStore'
import type { Artifact, ArtifactVersion } from '../types'

/**
 * useArtifacts — 随笔（多版本 + 回滚）的组合式 API
 * 封装 ArtifactStore 的常用状态与操作，供 UI 面板直接使用：
 * 列表 / 选中 / 版本列表 / 回滚 等。
 * 定位：原旧 Agent 面时代的「Agent 产物」预留存储（Agent 侧从未接线写入），
 * 2026-10-26 重定位为用户侧「随笔」；存储标识符保留 artifact 命名。
 */
export function useArtifacts() {
  const store = useArtifactStore()

  /** 当前全部随笔（按更新时间倒序） */
  const artifacts = computed(() => store.artifacts)
  const loading = computed(() => store.loading)
  const error = computed(() => store.error)
  const totalCount = computed(() => store.totalCount)

  /** 加载当前项目全部随笔及版本 */
  async function loadAll() {
    await store.loadAll()
  }

  /** 项目切换时清空内存态 */
  function reset() {
    store.reset()
  }

  /** 新建随笔 */
  async function create(input: { title: string; content: string; artifact_type?: string }) {
    return store.create(input)
  }

  /** 更新随笔（内容变化自动追加版本） */
  async function update(id: string, patch: { title?: string; content?: string; artifact_type?: string }) {
    await store.update(id, patch)
  }

  /** 回滚到指定版本 */
  async function rollback(id: string, version: number) {
    await store.rollback(id, version)
  }

  /** 获取随笔全部历史版本（按版本号降序） */
  async function getVersions(id: string): Promise<ArtifactVersion[]> {
    return store.getVersions(id)
  }

  /** 删除随笔（含全部版本） */
  async function remove(id: string) {
    await store.remove(id)
  }

  return {
    artifacts,
    loading,
    error,
    totalCount,
    loadAll,
    reset,
    create,
    update,
    rollback,
    getVersions,
    remove,
  }
}

export type { Artifact, ArtifactVersion }