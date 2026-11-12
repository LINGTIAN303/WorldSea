<template>
  <div v-if="node" class="nls">
    <div class="nls-head">
      <span class="nls-title">横向关系</span>
      <button class="nls-add" type="button" @click="openPicker">＋ 添加</button>
    </div>

    <div v-if="rows.length" class="nls-list">
      <div v-for="r in rows" :key="r.relationId" class="nls-item">
        <span class="nls-rel">{{ r.relLabel }}</span>
        <button class="nls-name" type="button" :title="`点击跳转「${r.name}」`" @click="jumpTo(r)">{{ r.name }}</button>
        <button
          v-if="r.altType"
          class="nls-act"
          type="button"
          :title="`改为「${r.altLabel}」`"
          @click="swapType(r)"
        >改「{{ r.altLabel }}」</button>
        <button class="nls-act nls-act--danger" type="button" title="解除关系（不删除节点）" @click="unlink(r)">解除</button>
      </div>
    </div>
    <div v-else class="nls-empty">暂无横向关系</div>

    <!-- 添加浮层：候选 = 其它大纲节点（排除自身与已关联）；关系类型先选后点 -->
    <FloatingPanel
      v-model:visible="pickerOpen"
      v-model:pinned="pickerPinned"
      title="添加横向关系"
      :width="260"
      :height="340"
      :trigger-rect="triggerRect"
    >
      <div class="nls-picker">
        <div class="nls-types">
          <button
            v-for="t in LATERAL_TYPES"
            :key="t.type"
            class="nls-type"
            :class="{ active: relType === t.type }"
            type="button"
            @click="relType = t.type"
          >{{ t.label }}</button>
        </div>
        <input v-model="query" class="nls-input" type="text" placeholder="搜索节点名称…" />
        <div class="nls-cands">
          <button v-for="c in candidates" :key="c.id" class="nls-cand" type="button" @click="linkTo(c)">
            <span class="nls-cand-name">{{ c.name }}</span>
          </button>
          <div v-if="!candidates.length" class="nls-cand-empty">
            {{ query ? '无匹配节点' : '没有可添加的节点' }}
          </div>
        </div>
      </div>
    </FloatingPanel>
  </div>
</template>

<script setup lang="ts">
/**
 * 「横向关系」编辑区（2026-10-18，Q3-A 裁定 · 批计划 docs/plans/2026-10-18-大纲横向关系补全批计划.md §二）
 *
 * 三条关系：并列 `outline_parallel` / 递进 `outline_progressive` / 对比 `outline_contrast`。
 * **对端也是大纲节点**（与「关联实体」区不是一组，勿混）；呈现为标记/徽章，不做白板连线。
 * 写路径唯一经 `@/entity/outlineLinks`（幂等、对称关系双向判重、不静默回退）。
 */
import { computed, onMounted, ref } from 'vue'
import { relationshipRegistry } from '@worldsea/entity-core'
import { entitiesSvc, outlineLinkStore, relationsSvc } from '../../serviceAccess'
import type { Entity, Relation } from '@worldsea/entity-core'
// 芽视图里的 UI 组件必须显式导入（不是全局组件）
import { FloatingPanel } from '@worldsea/ui-kit'
import {
  OUTLINE_LATERAL_RELATION,
  lateralRelationsOf,
  linkOutlineLateral,
  unlinkOutlineLateral,
} from '@/entity/outlineLinks'

const props = defineProps<{ node?: Entity }>()

const es = entitiesSvc()
const rs = relationsSvc()

onMounted(() => {
  if (!rs.list().length) void rs.reload()
  if (!es.list().length) void es.reload()
})

const LATERAL_TYPES = [
  { type: OUTLINE_LATERAL_RELATION.parallel, label: '并列' },
  { type: OUTLINE_LATERAL_RELATION.progressive, label: '递进' },
  { type: OUTLINE_LATERAL_RELATION.contrast, label: '对比' },
] as const

const allTypes = Object.values(OUTLINE_LATERAL_RELATION) as string[]

interface LateralRow {
  relationId: string
  otherId: string
  name: string
  relType: string
  /** 显示用标签：当前节点是 source 时取正向 label，是 target 时取 inverse label */
  relLabel: string
  altType: string | null
  altLabel: string
}

/** 关系标签（区分方向：递进的反向是「承接」） */
function labelOf(rel: Relation, nodeId: string): string {
  const fwd = relationshipRegistry.get(rel.type)?.label ?? rel.type
  if (rel.sourceId === nodeId) return fwd
  const inverse = relationshipRegistry.getInverseType(rel.type)
  return (inverse && relationshipRegistry.get(inverse)?.label) || fwd
}

const rows = computed<LateralRow[]>(() => {
  if (!props.node) return []
  const out: LateralRow[] = []
  for (const rel of lateralRelationsOf(rs.list(), props.node.id, allTypes)) {
    const otherId = rel.sourceId === props.node.id ? rel.targetId : rel.sourceId
    const other = es.get(otherId)
    if (!other) continue // 孤儿关系（节点已删）不显示——与关联实体同语义
    // 「改类型」只列同组其余两条（不含当前）；对称关系的反向也按同一条目处理
    const alts = allTypes.filter(t => t !== rel.type)
    out.push({
      relationId: rel.id,
      otherId: other.id,
      name: (other.name ?? '').trim() || '未命名',
      relType: rel.type,
      relLabel: labelOf(rel, props.node.id),
      altType: alts[0] ?? null,
      altLabel: alts[0] ? (relationshipRegistry.get(alts[0])?.label ?? alts[0]) : '',
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh') || a.relType.localeCompare(b.relType))
})

// ── 添加浮层 ──
const pickerOpen = ref(false)
const pickerPinned = ref(false)
const triggerRect = ref<DOMRect | null>(null)
const query = ref('')
const relType = ref<string>(OUTLINE_LATERAL_RELATION.parallel)

function openPicker(ev: MouseEvent): void {
  const el = ev.currentTarget as HTMLElement | null
  triggerRect.value = el ? el.getBoundingClientRect() : null
  query.value = ''
  relType.value = OUTLINE_LATERAL_RELATION.parallel
  pickerOpen.value = true
}

const candidates = computed(() => {
  if (!pickerOpen.value || !props.node) return []
  const linked = new Set(rows.value.map(r => r.otherId))
  const q = query.value.trim().toLowerCase()
  return es.list()
    .filter(e => e.type === 'outline_node' && e.id !== props.node!.id && !linked.has(e.id))
    .filter(e => !q || (e.name ?? '').toLowerCase().includes(q))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'zh'))
    .slice(0, 50)
    .map(e => ({ id: e.id, name: (e.name ?? '').trim() || '未命名' }))
})

// ── 写路径（唯一入口 outlineLinks；relationStore 传入即得即时刷新）──
async function linkTo(c: { id: string }): Promise<void> {
  if (!props.node) return
  await linkOutlineLateral(outlineLinkStore(), props.node.id, c.id, relType.value)
}

async function unlink(r: LateralRow): Promise<void> {
  if (!props.node) return
  await unlinkOutlineLateral(outlineLinkStore(), props.node.id, r.otherId, r.relType)
}

/** 「改类型」：先建新（幂等）再删旧——中途失败不丢关系 */
async function swapType(r: LateralRow): Promise<void> {
  if (!props.node || !r.altType) return
  await linkOutlineLateral(outlineLinkStore(), props.node.id, r.otherId, r.altType)
  await unlinkOutlineLateral(outlineLinkStore(), props.node.id, r.otherId, r.relType)
}

/** 跳转节点（ws-navigate 契约 {entityType, entityId}） */
function jumpTo(r: LateralRow): void {
  window.dispatchEvent(new CustomEvent('ws-navigate', { detail: { entityType: 'outline_node', entityId: r.otherId } }))
}
</script>

<style scoped>
.nls { display: flex; flex-direction: column; gap: 6px; }
.nls-head { display: flex; align-items: center; justify-content: space-between; }
.nls-title { font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.nls-add {
  padding: 0 6px; height: 20px;
  border: 1px solid var(--border-color); border-radius: var(--radius-xs);
  background: transparent; color: var(--text-secondary);
  font-size: var(--font-size-2xs); font-family: inherit; cursor: pointer;
}
.nls-add:hover { border-color: var(--primary); color: var(--primary); }
.nls-list { display: flex; flex-direction: column; gap: 4px; }
.nls-item { display: flex; align-items: center; gap: 4px; min-width: 0; }
.nls-rel {
  flex-shrink: 0; padding: 0 4px; border-radius: var(--radius-xs);
  background: var(--bg-tertiary); color: var(--text-tertiary); font-size: var(--font-size-2xs);
}
.nls-name {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 0; border: none; background: transparent; text-align: left;
  color: var(--primary); font-size: var(--font-size-xs); font-family: inherit; cursor: pointer;
}
.nls-name:hover { text-decoration: underline; }
.nls-act {
  flex-shrink: 0; padding: 0 4px; height: 18px;
  border: 1px solid var(--border-color); border-radius: var(--radius-xs);
  background: transparent; color: var(--text-secondary);
  font-size: var(--font-size-2xs); font-family: inherit; cursor: pointer;
}
.nls-act:hover { border-color: var(--primary); color: var(--primary); }
.nls-act--danger:hover { border-color: var(--danger); color: var(--danger); }
.nls-empty { font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.nls-picker { display: flex; flex-direction: column; gap: 6px; height: 100%; min-height: 0; }
.nls-types { display: flex; gap: 4px; }
.nls-type {
  flex: 1; height: 22px;
  border: 1px solid var(--border-color); border-radius: var(--radius-xs);
  background: transparent; color: var(--text-secondary);
  font-size: var(--font-size-2xs); font-family: inherit; cursor: pointer;
}
.nls-type.active { border-color: var(--primary); color: var(--primary); }
.nls-input {
  width: 100%; height: 24px; padding: 0 6px;
  border: 1px solid var(--border-color); border-radius: var(--radius-xs);
  background: var(--input-bg); color: var(--text-color);
  font-size: var(--font-size-xs); font-family: inherit; outline: none;
}
.nls-cands { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.nls-cand {
  display: flex; align-items: center; gap: 6px; width: 100%; padding: 4px 6px;
  border: none; border-radius: var(--radius-xs); background: transparent;
  color: var(--text-color); font-size: var(--font-size-xs); font-family: inherit;
  cursor: pointer; text-align: left;
}
.nls-cand:hover { background: var(--hover-bg); }
.nls-cand-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nls-cand-empty { padding: 12px 0; text-align: center; font-size: var(--font-size-2xs); color: var(--text-tertiary); }
</style>
