/**
 * 形象图编辑器草稿状态（F2）：draft/focus/dirty + 一次性保存 + 撤销/重做快照栈。
 * 快照用 JSON 深拷贝（编辑器数据仅原始值，且避开响应式代理的 DataCloneError）；
 * 250ms 防抖把拖动/连续输入合并为一步；历史上限 50 步。
 */
import { nextTick, reactive, ref, watch } from 'vue'
import {
  useEntityStore,
  type Entity,
  type MotionConfig,
  type MotionRegion,
  type MotionTrack,
} from '@worldsea/entity-core'

interface DraftSnapshot {
  regions: MotionRegion[]
  tracks: MotionTrack[]
  focus: { position?: string; zoom?: number }
}

const MAX_HISTORY = 50
const SNAPSHOT_DEBOUNCE_MS = 250

export function useMotionDraft(entity: Entity) {
  const entityStore = useEntityStore()

  const draft = reactive<MotionConfig>({
    regions: (entity.portraitMeta?.motion?.regions ?? []).map(r => ({ ...r })),
    tracks: (entity.portraitMeta?.motion?.tracks ?? []).map(t => ({ ...t })),
  })
  const draftFocus = reactive({
    position: entity.portraitMeta?.focus?.position,
    zoom: entity.portraitMeta?.focus?.zoom,
  })
  const dirty = ref(false)
  const selectedRegionId = ref<string | null>(draft.regions[0]?.id ?? null)

  function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  function cloneSnapshot(): DraftSnapshot {
    return deepClone({
      regions: draft.regions,
      tracks: draft.tracks,
      focus: { position: draftFocus.position, zoom: draftFocus.zoom },
    })
  }

  let snapshotTimer: ReturnType<typeof setTimeout> | null = null
  let restoring = false
  const undoStack = ref<DraftSnapshot[]>([cloneSnapshot()])
  const redoStack = ref<DraftSnapshot[]>([])
  const pendingSnapshot = ref(false)

  function commitSnapshot() {
    if (snapshotTimer) clearTimeout(snapshotTimer)
    snapshotTimer = null
    pendingSnapshot.value = false
    undoStack.value.push(cloneSnapshot())
    if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift()
  }

  function scheduleSnapshot() {
    if (snapshotTimer) clearTimeout(snapshotTimer)
    redoStack.value = [] // 新编辑立即作废重做（不等防抖）
    pendingSnapshot.value = true
    snapshotTimer = setTimeout(commitSnapshot, SNAPSHOT_DEBOUNCE_MS)
  }

  function cancelPendingSnapshot() {
    if (snapshotTimer) clearTimeout(snapshotTimer)
    snapshotTimer = null
    pendingSnapshot.value = false
  }

  /** 恢复快照：splice 保持 draft 数组引用（响应链不断），深拷贝防快照被后续编辑污染 */
  function restore(snap: DraftSnapshot) {
    restoring = true
    draft.regions.splice(0, draft.regions.length, ...deepClone(snap.regions))
    draft.tracks.splice(0, draft.tracks.length, ...deepClone(snap.tracks))
    draftFocus.position = snap.focus.position
    draftFocus.zoom = snap.focus.zoom
    selectedRegionId.value = draft.regions[0]?.id ?? null
    dirty.value = true
    void nextTick(() => { restoring = false })
  }

  function undo() {
    if (snapshotTimer) commitSnapshot() // 防抖窗口内的改动先落快照，撤销才能回到上一状态
    if (undoStack.value.length <= 1) return
    redoStack.value.push(undoStack.value.pop()!)
    restore(undoStack.value[undoStack.value.length - 1])
  }

  function redo() {
    const next = redoStack.value.pop()
    if (!next) return
    cancelPendingSnapshot()
    undoStack.value.push(next)
    restore(next)
  }

  watch([draft, draftFocus], () => {
    dirty.value = true
    if (!restoring) scheduleSnapshot()
  }, { deep: true })

  function save() {
    const motion = draft.tracks.length ? { regions: draft.regions, tracks: draft.tracks } : undefined
    const focus = (draftFocus.position || draftFocus.zoom) ? { position: draftFocus.position, zoom: draftFocus.zoom } : undefined
    entityStore.update(entity.id, { portraitMeta: { ...entity.portraitMeta, motion, focus } })
    dirty.value = false
  }

  return {
    draft,
    draftFocus,
    dirty,
    selectedRegionId,
    save,
    undoStack,
    redoStack,
    pendingSnapshot,
    undo,
    redo,
    cancelPendingSnapshot,
  }
}
