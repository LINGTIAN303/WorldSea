/**
 * 思维导图文档 Store —— 唯一真相源
 *
 * 管理导图文档索引与当前打开的文档；持久化委托给 mindmapDoc.ts
 * （localStorage 回退 + 项目 DB 主存，项目级隔离）。
 * 项目切换时由 useProjectSwitcher.reloadStores 调用 loadAll() 重载。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  loadDocIndex, saveDocIndex, loadDoc, saveDoc, removeDoc,
  newDocData, genId,
  type MindmapDocMeta, type MindmapDoc,
} from './mindmapDoc'
import type { MindElixirData } from 'mind-elixir'

export const useMindmapDocStore = defineStore('mindmapDocs', () => {
  /** 文档索引（不含树数据，列表渲染用） */
  const docs = ref<MindmapDocMeta[]>([])
  /** 当前打开的文档 id */
  const currentId = ref<string | null>(null)
  /** 加载/保存状态提示（保存中… / 已保存） */
  const saveState = ref<'idle' | 'saving' | 'saved'>('idle')

  const currentMeta = computed(() => docs.value.find(d => d.id === currentId.value) ?? null)
  const sortedDocs = computed(() => [...docs.value].sort((a, b) => b.updatedAt - a.updatedAt))

  /**
   * 加载文档索引（芽挂载 / 项目切换时调用）。
   * 空项目自动建一张默认导图，保证画布非空。
   */
  async function loadAll(): Promise<void> {
    docs.value = loadDocIndex()
    if (docs.value.length === 0) {
      const meta: MindmapDocMeta = {
        id: genId(),
        name: '第一张导图',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      const doc: MindmapDoc = { ...meta, data: newDocData() }
      saveDoc(doc)
      saveDocIndex([meta])
      docs.value = [meta]
      currentId.value = meta.id
      return
    }
    // 恢复最近编辑的一张
    if (!currentId.value || !docs.value.some(d => d.id === currentId.value)) {
      currentId.value = sortedDocs.value[0]?.id ?? null
    }
  }

  /** 新建导图（返回新文档 id） */
  function createDoc(name: string): string {
    const meta: MindmapDocMeta = {
      id: genId(),
      name: name.trim() || '未命名导图',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const doc: MindmapDoc = { ...meta, data: newDocData() }
    saveDoc(doc)
    docs.value = [...docs.value, meta]
    saveDocIndex(docs.value)
    return meta.id
  }

  /** 重命名文档 */
  function renameDoc(id: string, name: string) {
    const meta = docs.value.find(d => d.id === id)
    const trimmed = name.trim()
    if (!meta || !trimmed || meta.name === trimmed) return
    meta.name = trimmed
    meta.updatedAt = Date.now()
    saveDocIndex(docs.value)
    // 同步文档体内冗余的 meta（文档体以树数据为主，名字以索引为准；此处双写保持一致）
    const doc = loadDoc(id)
    if (doc) {
      doc.name = trimmed
      saveDoc(doc)
    }
  }

  /** 删除文档（索引 + 文档体；当前打开的是它时切换到最近一张） */
  function deleteDoc(id: string) {
    docs.value = docs.value.filter(d => d.id !== id)
    saveDocIndex(docs.value)
    removeDoc(id)
    if (currentId.value === id) {
      currentId.value = sortedDocs.value[0]?.id ?? null
    }
  }

  /** 读取当前文档的树数据（打开画布时用） */
  function getDocData(id: string): MindElixirData | null {
    const doc = loadDoc(id)
    return doc?.data ?? null
  }

  /** 保存当前文档的树数据（由视图层在 operation 事件中防抖调用） */
  function persistDocData(id: string, data: MindElixirData) {
    const meta = docs.value.find(d => d.id === id)
    if (!meta) return
    saveState.value = 'saving'
    const doc: MindmapDoc = { ...meta, data }
    saveDoc(doc)
    meta.updatedAt = Date.now()
    saveDocIndex(docs.value)
    saveState.value = 'saved'
  }

  return {
    docs, currentId, currentMeta, sortedDocs, saveState,
    loadAll, createDoc, renameDoc, deleteDoc, getDocData, persistDocData,
  }
})
