/**
 * useBoardDocs —— 白板列表与「两层导航」状态
 *
 * 两层导航（照 manuscript 芽书籍列表先例）：`currentBoardId === null` 为列表层，
 * 非 null 为编辑器层。列表数据来自实体 store（type === 'outline_board'）。
 */
import { computed, ref } from 'vue'
import { useEntityStore } from '@worldsea/entity-core'
import { createEmptyBoardLayout, genBoardId, parseBoardLayout, serializeBoardLayout } from '../layoutSchema'
import type { SnapMode } from './useBoardSnap'

export const DEFAULT_BOARD_NAME = '未命名白板'

export function useBoardDocs() {
  const es = useEntityStore()

  /** null = 列表层；非 null = 编辑器层（当前白板 id） */
  const currentBoardId = ref<string | null>(null)

  /** 按更新时间倒序（最近的在前） */
  const boards = computed(() =>
    (es.entities ?? [])
      .filter(e => e.type === 'outline_board')
      .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))),
  )

  const currentBoard = computed(
    () => boards.value.find(b => b.id === currentBoardId.value) ?? null,
  )
  const inEditor = computed(() => !!currentBoard.value)

  /** 加载全部实体（白板与大纲节点都要：白板渲染依赖 outline_node） */
  async function loadAll(): Promise<void> {
    await es.loadAll()
  }

  async function createBoard(name: string = DEFAULT_BOARD_NAME): Promise<string> {
    const now = new Date().toISOString()
    const id = genBoardId('board')
    await es.add({
      id,
      type: 'outline_board',
      name: name.trim() || DEFAULT_BOARD_NAME,
      description: '',
      properties: {
        // 视口**故意留空**：表示「从未设置」→ 首次进入时由视图层做「适配全部」
        // （若这里写死默认值，视图层就无法区分「用户设过 zoom=1」与「从未设置」）
        viewport: '',
        layout: serializeBoardLayout(createEmptyBoardLayout()),
        thumbnail: '',
        snap: 'guides',
        gridEnabled: true,
      },
      tags: [],
      createdAt: now,
      updatedAt: now,
    })
    return id
  }

  /** 新建并直接进入编辑器（列表层「新建白板」的默认行为） */
  async function createAndOpen(name: string = DEFAULT_BOARD_NAME): Promise<string> {
    const id = await createBoard(name)
    currentBoardId.value = id
    return id
  }

  async function renameBoard(id: string, name: string): Promise<void> {
    const next = (name ?? '').trim()
    if (!next) return
    await es.update(id, { name: next })
  }

  /** 删除白板（只删白板实体与其布局，不动任何大纲节点） */
  async function deleteBoard(id: string): Promise<void> {
    await es.remove(id)
    if (currentBoardId.value === id) currentBoardId.value = null
  }

  function openBoard(id: string): void {
    currentBoardId.value = id
  }

  function backToList(): void {
    currentBoardId.value = null
  }

  /** 卡片上的容器数（容错解析，坏数据按 0 计） */
  function containerCount(boardId: string): number {
    const board = boards.value.find(b => b.id === boardId)
    if (!board) return 0
    return parseBoardLayout(board.properties?.layout).containers.length
  }

  /**
   * 写回白板级设置（吸附模式 / 网格开关）。
   * 实体更新是「properties 整体替换」语义，故必须先合并当前 properties——
   * 否则会把 layout / viewport / thumbnail 一起抹掉（与 useBoardLayout.saveNow 同一纪律）。
   */
  async function updateBoardProps(id: string, patch: Record<string, unknown>): Promise<void> {
    const board = boards.value.find(b => b.id === id)
    if (!board) return
    await es.update(id, { properties: { ...board.properties, ...patch } })
  }

  async function setBoardSnap(id: string, mode: SnapMode): Promise<void> {
    await updateBoardProps(id, { snap: mode })
  }

  async function setBoardGridEnabled(id: string, enabled: boolean): Promise<void> {
    await updateBoardProps(id, { gridEnabled: enabled })
  }

  return {
    boards,
    currentBoard,
    currentBoardId,
    inEditor,
    loadAll,
    createBoard,
    createAndOpen,
    renameBoard,
    deleteBoard,
    openBoard,
    backToList,
    containerCount,
    setBoardSnap,
    setBoardGridEnabled,
  }
}
