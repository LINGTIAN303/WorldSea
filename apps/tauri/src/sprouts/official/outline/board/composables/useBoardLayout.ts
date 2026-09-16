/**
 * useBoardLayout —— 白板布局体的读写与保存（唯一写入口）
 *
 * 【唯一真相】白板实体 `properties.layout`（JSON 串）。视图层通过本模块的原子操作改布局，
 * 不直接操作 store，保证「改了就一定会被保存」。
 *
 * 【保存语义（项目既有教训）】实体更新 = 顶层浅合并 + **properties 整体替换**，
 * 故每次保存都必须「基于当前实体 properties 合并」后整体提交，否则会抹掉 viewport / thumbnail 等字段。
 *
 * 【防抖】布局变更（拖拽/增删）走 ≥500ms 防抖；退出编辑器时必须调 saveNow() 立即落盘。
 * 详见 docs/plans/2026-09-16-大纲白板-编辑器交互规格.md §七。
 */
import { ref } from 'vue'
import { useEntityStore, type Entity } from '@worldsea/entity-core'
import {
  createDefaultViewport,
  parseViewport,
  serializeViewport,
  type Point,
  type Viewport,
} from '../boardGeometry'
import {
  createComponent,
  createContainer,
  createEmptyBoardLayout,
  danglingContainerIds,
  findContainer,
  findContainerByNode,
  nextComponentOrder,
  parseBoardLayout,
  removeContainers,
  replaceContainer,
  reorderComponents,
  serializeBoardLayout,
  type BoardContainer,
  type OutlineBoardLayout,
} from '../layoutSchema'

/** 布局保存防抖（与 drawing 芽的 AUTOSAVE_DELAY 对齐量级） */
export const BOARD_SAVE_DEBOUNCE = 500
/** 「已保存」提示的保留时长，之后回落到 idle */
export const BOARD_SAVED_HOLD = 2000

export type BoardSaveState = 'idle' | 'saving' | 'saved' | 'error'

export function useBoardLayout() {
  const es = useEntityStore()

  const boardId = ref<string | null>(null)
  const layout = ref<OutlineBoardLayout>(createEmptyBoardLayout())
  /** 视口也由本模块托管：与布局共用一处保存入口，避免两条写路径互相覆盖 properties */
  const viewport = ref<Viewport>(createDefaultViewport())
  const saveState = ref<BoardSaveState>('idle')

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let holdTimer: ReturnType<typeof setTimeout> | null = null

  function clearTimers(): void {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (holdTimer) {
      clearTimeout(holdTimer)
      holdTimer = null
    }
  }

  function boardEntity(id: string | null = boardId.value): Entity | undefined {
    if (!id) return undefined
    return (es.entities ?? []).find(e => e.id === id && e.type === 'outline_board')
  }

  /** 载入指定白板的布局体与视口（调用前需确保 store 已含 outline_board 实体，视图层用 loadAll） */
  async function load(id: string): Promise<boolean> {
    clearTimers()
    boardId.value = id
    const board = boardEntity(id)
    layout.value = parseBoardLayout(board?.properties?.layout)
    viewport.value = parseViewport(board?.properties?.viewport)
    saveState.value = 'idle'
    return !!board
  }

  /** 设置视口（走同一防抖保存链） */
  function setViewport(next: Viewport): void {
    viewport.value = { ...next }
    scheduleSave()
  }

  function scheduleSave(): void {
    if (holdTimer) {
      clearTimeout(holdTimer)
      holdTimer = null
    }
    saveState.value = 'saving'
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void saveNow()
    }, BOARD_SAVE_DEBOUNCE)
  }

  /** 立即落盘（退出编辑器 / 卸载前必须调用） */
  async function saveNow(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const id = boardId.value
    if (!id) return
    const board = boardEntity(id)
    if (!board) {
      saveState.value = 'error'
      return
    }
    saveState.value = 'saving'
    try {
      await es.update(id, {
        // properties 整体替换 → 先合并现有字段（§7 保存约定）
        properties: {
          ...board.properties,
          layout: serializeBoardLayout(layout.value),
          viewport: serializeViewport(viewport.value),
        },
      })
      saveState.value = 'saved'
      if (holdTimer) clearTimeout(holdTimer)
      holdTimer = setTimeout(() => {
        if (saveState.value === 'saved') saveState.value = 'idle'
      }, BOARD_SAVED_HOLD)
    } catch {
      saveState.value = 'error'
    }
  }

  /** 统一变更入口：替换布局并调度保存 */
  function mutate(next: OutlineBoardLayout): void {
    layout.value = next
    scheduleSave()
  }

  /** 整体替换布局（撤销/重做回放用；同样走保存链） */
  function replaceLayout(next: OutlineBoardLayout): void {
    mutate(next)
  }

  // ── 容器操作 ─────────────────────────────

  /**
   * 新建容器。同板内该节点已有容器时返回 null（判定 §8.10.5-B：一板一节点一容器；
   * 视图层据此把「重复拖入」转为「定位已有容器」）。
   */
  function addContainer(nodeId: string, pos: Point, sectionId?: string): string | null {
    if (!nodeId) return null
    if (findContainerByNode(layout.value, nodeId)) return null
    const container = createContainer(nodeId, pos, sectionId ? { sectionId } : {})
    mutate({ ...layout.value, containers: [...layout.value.containers, container] })
    return container.id
  }

  /** 删除容器（只删布局，不删节点——与树视图/实体数据无关） */
  function removeContainerById(containerId: string): void {
    if (!findContainer(layout.value, containerId)) return
    mutate(removeContainers(layout.value, [containerId]))
  }

  function moveContainer(containerId: string, pos: Point): void {
    const c = findContainer(layout.value, containerId)
    if (!c) return
    if (c.pos.x === pos.x && c.pos.y === pos.y) return
    mutate(replaceContainer(layout.value, containerId, {
      ...c,
      pos: { x: Math.round(pos.x), y: Math.round(pos.y) },
    }))
  }

  function resizeContainer(containerId: string, size: { w: number; h: number } | undefined): void {
    const c = findContainer(layout.value, containerId)
    if (!c) return
    const next: BoardContainer = { ...c }
    if (size) next.size = { w: Math.max(120, Math.round(size.w)), h: Math.max(48, Math.round(size.h)) }
    else delete next.size
    mutate(replaceContainer(layout.value, containerId, next))
  }

  function toggleCollapsed(containerId: string): void {
    const c = findContainer(layout.value, containerId)
    if (!c) return
    mutate(replaceContainer(layout.value, containerId, { ...c, collapsed: !c.collapsed }))
  }

  /** 归属区（传 null / '' 表示脱离区） */
  function setContainerSection(containerId: string, sectionId: string | null): void {
    const c = findContainer(layout.value, containerId)
    if (!c) return
    const next: BoardContainer = { ...c }
    if (sectionId) next.sectionId = sectionId
    else delete next.sectionId
    mutate(replaceContainer(layout.value, containerId, next))
  }

  // ── 组件操作 ─────────────────────────────

  function addComponent(containerId: string, form: string): string | null {
    const c = findContainer(layout.value, containerId)
    if (!c) return null
    const component = createComponent(form, nextComponentOrder(c))
    mutate(replaceContainer(layout.value, containerId, {
      ...c,
      components: [...c.components, component],
    }))
    return component.id
  }

  function removeComponent(containerId: string, componentId: string): void {
    const c = findContainer(layout.value, containerId)
    if (!c) return
    const components = c.components.filter(x => x.id !== componentId)
    if (components.length === c.components.length) return
    mutate(replaceContainer(layout.value, containerId, { ...c, components }))
  }

  function updateComponentConfig(
    containerId: string,
    componentId: string,
    patch: Record<string, unknown>,
  ): void {
    const c = findContainer(layout.value, containerId)
    if (!c) return
    const components = c.components.map(x =>
      x.id === componentId ? { ...x, config: { ...(x.config ?? {}), ...patch } } : x,
    )
    mutate(replaceContainer(layout.value, containerId, { ...c, components }))
  }

  function reorderContainerComponents(containerId: string, orderedIds: string[]): void {
    const c = findContainer(layout.value, containerId)
    if (!c) return
    mutate(replaceContainer(layout.value, containerId, reorderComponents(c, orderedIds)))
  }

  // ── 悬空容器（节点被删）──

  /** 列出悬空容器 id（渲染占位 + 是否可清理的依据） */
  function listDangling(existingNodeIds: Set<string>): string[] {
    return danglingContainerIds(layout.value, existingNodeIds)
  }

  /** 显式清理悬空容器（由用户点击触发，绝不自动执行） */
  function cleanupDangling(existingNodeIds: Set<string>): number {
    const ids = danglingContainerIds(layout.value, existingNodeIds)
    if (!ids.length) return 0
    mutate(removeContainers(layout.value, ids))
    return ids.length
  }

  /** 卸载前调用：清掉未触发的定时器（不改数据） */
  function dispose(): void {
    clearTimers()
  }

  return {
    boardId,
    layout,
    viewport,
    saveState,
    load,
    saveNow,
    dispose,
    setViewport,
    replaceLayout,
    addContainer,
    removeContainerById,
    moveContainer,
    resizeContainer,
    toggleCollapsed,
    setContainerSection,
    addComponent,
    removeComponent,
    updateComponentConfig,
    reorderContainerComponents,
    listDangling,
    cleanupDangling,
  }
}
