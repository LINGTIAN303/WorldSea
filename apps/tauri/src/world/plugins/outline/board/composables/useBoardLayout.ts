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
  hasSavedViewport,
  parseViewport,
  serializeViewport,
  type Point,
  type Rect,
  type Viewport,
} from '../boardGeometry'
import {
  createComponent,
  createContainer,
  createEmptyBoardLayout,
  createSection,
  danglingContainerIds,
  findContainer,
  findContainerByNode,
  findSection,
  nextComponentOrder,
  nextSectionOrder,
  parseBoardLayout,
  rectOfContainer,
  removeContainers,
  removeSections,
  replaceContainer,
  replaceSection,
  reorderComponents,
  resolveSectionFor,
  serializeBoardLayout,
  setContainerSectionId,
  shiftSectionWithContainers,
  type BoardContainer,
  type BoardSection,
  type OutlineBoardLayout,
  type SectionArrange,
} from '../layoutSchema'
import { clampContainerTop, shouldRearrangeOnResize } from '../sectionArrange'
import { arrangeSectionInLayout } from '../sectionLayout'

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
  /** 缩略图（dataURL）：同样托管在此，与布局/视口共用一次落盘（避免三条写路径各自整体替换 properties） */
  const thumbnail = ref('')
  const saveState = ref<BoardSaveState>('idle')
  /**
   * 「首次进入适配」标记：该白板从未保存过视口时置真，
   * 视图层据此在首帧用 fitViewport 把内容带进视野（否则新建白板若容器在远处会看不到东西）。
   */
  const pendingFit = ref(false)

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

  /** 载入指定白板的布局体、视口与缩略图（调用前需确保 store 已含 outline_board 实体，视图层用 loadAll） */
  async function load(id: string): Promise<boolean> {
    clearTimers()
    boardId.value = id
    const board = boardEntity(id)
    layout.value = parseBoardLayout(board?.properties?.layout)
    const rawViewport = board?.properties?.viewport
    viewport.value = parseViewport(rawViewport)
    // 从未保存过视口（新建白板把 viewport 置空）→ 交给视图层做首次适配
    pendingFit.value = !hasSavedViewport(rawViewport)
    thumbnail.value = typeof board?.properties?.thumbnail === 'string'
      ? (board?.properties?.thumbnail as string)
      : ''
    saveState.value = 'idle'
    return !!board
  }

  /** 设置缩略图（退出编辑器时生成；与布局共用保存链） */
  function setThumbnail(dataUrl: string): void {
    thumbnail.value = dataUrl || ''
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
          thumbnail: thumbnail.value,
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
    if ((c.sectionId ?? null) === (sectionId || null)) return
    mutate(setContainerSectionId(layout.value, containerId, sectionId || null))
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

  // ── 区（Section）操作 ─────────────────────

  /**
   * 画区：新建一个区，并把**中心点落在区内**的既有容器自动纳入归属。
   * 归属规则与「容器拖动结束重算」完全一致（resolveSectionFor），所以用户画框圈住已有容器时
   * 不必再手动归位。区重叠时新画的在上（与渲染层级一致，由 hitTestRects 的「后绘制者在上」决定）。
   */
  function addSection(rect: Rect): string {
    const order = nextSectionOrder(layout.value)
    const section = createSection(rect, { title: `区 ${order}`, order })
    let next: OutlineBoardLayout = { ...layout.value, sections: [...layout.value.sections, section] }
    next = {
      ...next,
      containers: next.containers.map(c => {
        const sid = resolveSectionFor(next, rectOfContainer(c))
        return sid === section.id ? { ...c, sectionId: section.id } : c
      }),
    }
    mutate(next)
    return section.id
  }

  function renameSection(sectionId: string, title: string): void {
    const s = findSection(layout.value, sectionId)
    if (!s) return
    const nextTitle = title.trim()
    if ((s.title ?? '') === nextTitle) return
    const next: BoardSection = { ...s }
    if (nextTitle) next.title = nextTitle
    else delete next.title
    mutate(replaceSection(layout.value, sectionId, next))
  }

  /** 区平移：**区与其内容器整体移动**（一次原子变更 → 撤销只需一步） */
  function moveSectionTo(sectionId: string, rect: Rect): void {
    const s = findSection(layout.value, sectionId)
    if (!s) return
    const dx = Math.round(rect.x) - s.rect.x
    const dy = Math.round(rect.y) - s.rect.y
    if (!dx && !dy) return
    mutate(shiftSectionWithContainers(layout.value, sectionId, dx, dy))
  }

  /**
   * 区调整尺寸：`free` 保持容器相对位置；其余排布模式按 gap 重排（规格 §二）。
   * 重排与区尺寸同处**一次 mutate** —— 避免「区已变大但容器没跟上」的中间态被保存或入撤销栈。
   */
  function resizeSection(sectionId: string, rect: Rect, opts: { rearrange?: boolean } = {}): void {
    const s = findSection(layout.value, sectionId)
    if (!s) return
    const nextRect: Rect = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.max(80, Math.round(rect.w)),
      h: Math.max(60, Math.round(rect.h)),
    }
    let next = replaceSection(layout.value, sectionId, { ...s, rect: nextRect })
    const rearrange = opts.rearrange ?? shouldRearrangeOnResize(s.arrange)
    if (rearrange) next = applyArrange(next, sectionId)
    mutate(next)
  }

  /** 切换区的排布方式（切换后立即按新方式排一次） */
  function setSectionArrange(sectionId: string, arrange: SectionArrange): void {
    const s = findSection(layout.value, sectionId)
    if (!s || s.arrange === arrange) return
    let next = replaceSection(layout.value, sectionId, { ...s, arrange })
    if (shouldRearrangeOnResize(arrange)) next = applyArrange(next, sectionId)
    mutate(next)
  }

  /** 按区的 arrange 重算其内容器坐标（只有容器位置变化，纯计算） */
  function applyArrange(layoutIn: OutlineBoardLayout, sectionId: string): OutlineBoardLayout {
    return arrangeSectionInLayout(layoutIn, sectionId)
  }

  /** 手动触发一次区内重排（属性面板「重新排列」用） */
  function rearrangeSection(sectionId: string): void {
    if (!findSection(layout.value, sectionId)) return
    mutate(applyArrange(layout.value, sectionId))
  }

  /** 删区二选一：`detach` = 仅删区、容器落回画布；`cascade` = 连区内容器一起删（**仍不删节点**） */
  function removeSectionById(sectionId: string, mode: 'detach' | 'cascade' = 'detach'): void {
    if (!findSection(layout.value, sectionId)) return
    mutate(removeSections(layout.value, [sectionId], mode))
  }

  /** 容器拖动结束后重算归属：中心点落在哪个区就归哪个区，未命中则脱离；
   *  归属区时把顶部钳到标题栏之下；非 free 区再按落点重排（13-C / 13-D）。 */
  function settleContainerSection(containerId: string): void {
    const c = findContainer(layout.value, containerId)
    if (!c) return
    const oldSid = c.sectionId ?? null
    const rect = rectOfContainer(c)
    const sid = resolveSectionFor(layout.value, rect)
    const y = clampContainerTop(rect, sid ? findSection(layout.value, sid)?.rect : null)
    if (oldSid === sid && c.pos.y === y) return
    let next = replaceContainer(layout.value, containerId, { ...c, sectionId: sid || undefined, pos: { x: c.pos.x, y } })
    // 旧区/新区各排一次；同一次 mutate，避免「已归属但未排」的中间态入库
    for (const id of new Set([oldSid, sid])) {
      const s = id ? findSection(next, id) : null
      if (s && s.arrange !== 'free') next = applyArrange(next, s.id)
    }
    mutate(next)
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
    thumbnail,
    pendingFit,
    saveState,
    load,
    saveNow,
    dispose,
    setViewport,
    setThumbnail,
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
    addSection,
    renameSection,
    moveSectionTo,
    resizeSection,
    setSectionArrange,
    rearrangeSection,
    removeSectionById,
    settleContainerSection,
    listDangling,
    cleanupDangling,
  }
}
