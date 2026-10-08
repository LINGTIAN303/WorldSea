<template>
  <div v-if="node" class="nrs">
    <div class="nrs-head">
      <span class="nrs-title">关联实体</span>
      <button class="nrs-add" type="button" @click="openPicker">＋ 添加</button>
    </div>

    <div v-if="refs.length" class="nrs-list">
      <div v-for="r in refs" :key="r.relationId" class="nrs-item">
        <button class="nrs-name" type="button" :title="`点击跳转「${r.name}」`" @click="jumpTo(r)">{{ r.name }}</button>
        <span class="nrs-rel">{{ r.relLabel }}</span>
        <button
          v-if="r.altType"
          class="nrs-act"
          type="button"
          :title="`改为「${r.altLabel}」`"
          @click="swapType(r)"
        >改「{{ r.altLabel }}」</button>
        <button class="nrs-act nrs-act--danger" type="button" title="解除关联（不删除实体）" @click="unlink(r)">解除</button>
      </div>
    </div>
    <div v-else class="nrs-empty">暂无关联实体</div>

    <!-- 添加浮层：候选=合法目标类型实体（注册表反查），点击即建（类型唯一合法直建；二义默认「专一者优先」） -->
    <FloatingPanel
      v-model:visible="pickerOpen"
      v-model:pinned="pickerPinned"
      title="添加关联实体"
      :width="260"
      :height="360"
      :trigger-rect="triggerRect"
    >
      <div class="nrs-picker">
        <input v-model="query" class="nrs-input" type="text" placeholder="搜索实体名称…" />
        <select v-model="typeFilter" class="nrs-select">
          <option value="">全部类型</option>
          <option v-for="t in targetTypes" :key="t" :value="t">{{ typeLabel(t) }}</option>
        </select>
        <div class="nrs-cands">
          <button v-for="c in candidates" :key="c.id" class="nrs-cand" type="button" @click="linkTo(c)">
            <WsIcon :name="iconOf(c.type)" size="xs" class="nrs-cand-icon" />
            <span class="nrs-cand-name">{{ c.name }}</span>
            <span class="nrs-cand-type">{{ typeLabel(c.type) }}</span>
          </button>
          <div v-if="!candidates.length" class="nrs-cand-empty">
            {{ query || typeFilter ? '无匹配实体' : '没有可添加的实体' }}
          </div>
        </div>
      </div>
    </FloatingPanel>
  </div>
</template>

<script setup lang="ts">
/**
 * 「关联实体」编辑行（2026-10-08；立项 docs/plans/2026-10-08-大纲用户侧实体关联立项.md）
 *
 * 自包含：读 relationStore（写后响应式即时刷新）、写入唯一经 outlineLinks（幂等、单向
 * node→entity、不静默回退）；关系类型从注册表反查——唯一合法直建，二义（如建筑
 * 「发生于/提及」）默认「专一者优先」并可在行内一键改。徽章（OutlineRefsForm）保持
 * 只读派生不动，本件是该家族的用户侧写入口。
 */
import { computed, onMounted, ref } from 'vue'
import { useEntityStore, useRelationStore, entitySchemaRegistry, relationshipRegistry } from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'
// 芽视图里的 UI 组件必须显式导入（不是全局组件）
import { FloatingPanel, WsIcon } from '@worldsea/ui-kit'
import { linkOutlineEntity, unlinkOutlineEntity } from '@/entity/outlineLinks'
import { pickRefRelationTypes, refRelationsOf, refRelationTypesForTarget, refTargetTypes } from '../forms/outlineRefs'

const props = defineProps<{ node?: Entity }>()

const es = useEntityStore()
const rs = useRelationStore()

// 关系与实体内存可能与别处加载面不同步，进入时各拉一次（幂等、判空省重载）
onMounted(() => {
  if (!rs.relations.length) void rs.loadAll()
  if (!es.entities.length) void es.loadAll()
})

const schemas = computed(() => relationshipRegistry.getBySourceType('outline_node'))
const refTypes = computed(() => pickRefRelationTypes(schemas.value))
const targetTypes = computed(() => refTargetTypes(schemas.value))

interface RefRow {
  relationId: string
  entityId: string
  entityType: string
  name: string
  relType: string
  relLabel: string
  /** 行内「改为」的目标类型（该目标还有其它合法类型时才显示按钮） */
  altType: string | null
  altLabel: string
}

const refs = computed<RefRow[]>(() => {
  if (!props.node) return []
  const rows: RefRow[] = []
  for (const rel of refRelationsOf(rs.relations, props.node.id, refTypes.value)) {
    const otherId = rel.sourceId === props.node.id ? rel.targetId : rel.sourceId
    const entity = es.entityMap.get(otherId)
    if (!entity) continue // 孤儿关系（实体已删）不显示——与徽章同语义
    const alts = refRelationTypesForTarget(schemas.value, entity.type).filter(t => t !== rel.type)
    rows.push({
      relationId: rel.id,
      entityId: entity.id,
      entityType: entity.type,
      name: (entity.name ?? '').trim() || '未命名',
      relType: rel.type,
      relLabel: relLabelOf(rel.type),
      altType: alts[0] ?? null,
      altLabel: alts[0] ? relLabelOf(alts[0]) : '',
    })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'zh') || a.relType.localeCompare(b.relType))
})

function relLabelOf(type: string): string { return relationshipRegistry.get(type)?.label || type }
function typeLabel(type: string): string { return entitySchemaRegistry.getLabel(type) || type }
function iconOf(type: string): string { return entitySchemaRegistry.getIconName(type) || 'link' }

// ── 添加浮层 ──
const pickerOpen = ref(false)
const pickerPinned = ref(false)
const triggerRect = ref<DOMRect | null>(null)
const query = ref('')
const typeFilter = ref('')

function openPicker(ev: MouseEvent): void {
  const el = ev.currentTarget as HTMLElement | null
  triggerRect.value = el ? el.getBoundingClientRect() : null
  query.value = ''
  typeFilter.value = ''
  pickerOpen.value = true
}

const candidates = computed(() => {
  if (!pickerOpen.value || !props.node) return []
  const linked = new Set(refs.value.map(r => r.entityId))
  const q = query.value.trim().toLowerCase()
  return es.entities
    .filter(e => targetTypes.value.includes(e.type) && !linked.has(e.id))
    .filter(e => !typeFilter.value || e.type === typeFilter.value)
    .filter(e => !q || (e.name ?? '').toLowerCase().includes(q))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'zh'))
    .slice(0, 50)
    .map(e => ({ id: e.id, type: e.type, name: (e.name ?? '').trim() || '未命名' }))
})

// ── 写路径（唯一入口 outlineLinks；relationStore 传入即得撤销记录与即时刷新）──
async function linkTo(c: { id: string; type: string }): Promise<void> {
  if (!props.node) return
  const types = refRelationTypesForTarget(schemas.value, c.type)
  if (!types.length) return
  await linkOutlineEntity(rs, props.node.id, c.id, types[0])
}

async function unlink(r: RefRow): Promise<void> {
  if (!props.node) return
  await unlinkOutlineEntity(rs, props.node.id, r.entityId, r.relType)
}

/** 「改类型」：先建新（幂等）再删旧——中途任何失败都不丢关联 */
async function swapType(r: RefRow): Promise<void> {
  if (!props.node || !r.altType) return
  await linkOutlineEntity(rs, props.node.id, r.entityId, r.altType)
  await unlinkOutlineEntity(rs, props.node.id, r.entityId, r.relType)
}

/** 跳转实体（ws-navigate 契约 {entityType, entityId}，2026-10-08 全链统一） */
function jumpTo(r: RefRow): void {
  window.dispatchEvent(new CustomEvent('ws-navigate', { detail: { entityType: r.entityType, entityId: r.entityId } }))
}
</script>

<style scoped>
.nrs { display: flex; flex-direction: column; gap: 6px; }
.nrs-head { display: flex; align-items: center; justify-content: space-between; }
.nrs-title { font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.nrs-add {
  padding: 0 6px;
  height: 20px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: transparent;
  /* 按钮文字必须显式设色（否则暗色主题回落到默认黑） */
  color: var(--text-secondary);
  font-size: var(--font-size-2xs);
  font-family: inherit;
  cursor: pointer;
}
.nrs-add:hover { border-color: var(--primary); color: var(--primary); }
.nrs-list { display: flex; flex-direction: column; gap: 4px; }
.nrs-item { display: flex; align-items: center; gap: 4px; min-width: 0; }
.nrs-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0;
  border: none;
  background: transparent;
  text-align: left;
  color: var(--primary);
  font-size: var(--font-size-xs);
  font-family: inherit;
  cursor: pointer;
}
.nrs-name:hover { text-decoration: underline; }
.nrs-rel {
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: var(--radius-xs);
  background: var(--bg-tertiary);
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
}
.nrs-act {
  flex-shrink: 0;
  padding: 0 4px;
  height: 18px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-2xs);
  font-family: inherit;
  cursor: pointer;
}
.nrs-act:hover { border-color: var(--primary); color: var(--primary); }
.nrs-act--danger:hover { border-color: var(--danger); color: var(--danger); }
.nrs-empty { font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.nrs-picker { display: flex; flex-direction: column; gap: 6px; height: 100%; min-height: 0; }
.nrs-input,
.nrs-select {
  width: 100%;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: var(--input-bg);
  color: var(--text-color);
  font-size: var(--font-size-xs);
  font-family: inherit;
  outline: none;
}
.nrs-cands { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.nrs-cand {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 6px;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-color);
  font-size: var(--font-size-xs);
  font-family: inherit;
  cursor: pointer;
  text-align: left;
}
.nrs-cand:hover { background: var(--hover-bg); }
.nrs-cand-icon { flex-shrink: 0; color: var(--text-secondary); }
.nrs-cand-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nrs-cand-type { flex-shrink: 0; font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.nrs-cand-empty { padding: 12px 0; text-align: center; font-size: var(--font-size-2xs); color: var(--text-tertiary); }
</style>
