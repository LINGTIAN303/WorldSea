<template>
  <CardDeck :count="3" :flat="!!searchQuery" ref="deckRef" @change="(i) => emit('card-change', i)">
    <template #card="{ idx, cls }">
      <div class="set-card deck-card" :class="cls" :data-index="idx"
        v-show="idx === 0 ? match('实体 详情 形态 内容形态 默认 分组 表格 段落 摘要 时间轴 form detail')
          : idx === 1 ? match('实体 详情 字段 顺序 排序 可见 隐藏 上移 下移 field order hidden')
          : match('实体 详情 形态 配置 属性数 摘录 描述 创建时间 config')">

        <!-- ① 内容形态（按类型） -->
        <template v-if="idx === 0">
          <div class="sc-head"><span>内容形态</span><span class="ds-type">{{ typeLabel }}</span></div>
          <div class="set-row"><span>实体类型</span>
            <select class="set-select" v-model="selectedType" aria-label="实体类型">
              <option v-for="t in types" :key="t.key" :value="t.key">{{ t.label }}</option>
            </select>
          </div>
          <div class="set-row"><span>详情正文形态</span>
            <div class="set-chip-group">
              <button v-for="f in forms" :key="f.form" type="button" class="set-chip"
                :class="{ on: f.form === layout.contentForm }" :title="f.description"
                @click="onPickForm(f.form)">
                <WsIcon :name="f.icon" size="xs" /><span>{{ f.label }}</span>
              </button>
            </div>
          </div>
          <div class="set-hint">
            这里是**类型级默认**：详情里手选过一次，就以那一类实体的手选为准（同键存放，不再多一层）。
            未覆写时按芽声明的默认形态。
          </div>
          <div v-if="hasOverride" class="set-btn-row">
            <button class="set-btn" type="button" @click="restoreSproutDefault">恢复芽默认</button>
          </div>
          <div v-else class="set-hint">该类型当前没有覆写（顺序、可见性、形态配置一并按芽声明与字段原序）。</div>
        </template>

        <!-- ② 字段顺序与可见性 -->
        <template v-else-if="idx === 1">
          <div class="sc-head"><span>字段顺序与可见性</span><span class="ds-type">{{ typeLabel }}</span></div>
          <div v-if="!rows.length" class="set-hint">该类型没有注册字段（自定义字段在详情里「＋ 添加字段」）。</div>
          <div v-for="(r, i) in rows" :key="r.key" class="set-row ds-field">
            <span class="ds-order">{{ i + 1 }}</span>
            <span class="ds-label" :class="{ 'is-hidden': r.hidden }">{{ r.label }}</span>
            <span class="ds-key">{{ r.key }}</span>
            <span class="ds-acts">
              <button class="ds-btn" type="button" :disabled="i === 0" aria-label="上移" @click="move(r.key, -1)">↑</button>
              <button class="ds-btn" type="button" :disabled="i === rows.length - 1" aria-label="下移" @click="move(r.key, 1)">↓</button>
            </span>
            <label class="set-toggle" :title="r.hidden ? '已隐藏，点开显示' : '显示中，点开隐藏'">
              <input type="checkbox" :checked="!r.hidden" @change="toggle(r.key)" />
              <span class="set-toggle-slider"></span>
            </label>
          </div>
          <div class="set-hint">标题固定在头部不占行；新增字段自动补在末尾，不会被旧覆写吞掉。</div>
        </template>

        <!-- ③ 形态配置（按当前形态的 configSchema 自动渲染） -->
        <template v-else>
          <div class="sc-head"><span>形态配置</span><span class="ds-type">{{ formLabel }}</span></div>
          <div v-if="!configSchema.length" class="set-hint">「{{ formLabel }}」没有可配置项。</div>
          <div v-for="field in configSchema" :key="field.key" class="set-row">
            <span>{{ field.label }}</span>
            <label v-if="field.type === 'boolean'" class="set-toggle">
              <input type="checkbox" :checked="config[field.key] !== false" @change="onConfigBool(field.key)" />
              <span class="set-toggle-slider"></span>
            </label>
            <input v-else-if="field.type === 'number'" type="number" class="set-input set-input-sm"
              :value="Number(config[field.key] ?? field.default)" min="1" @input="onConfigInput(field, $event)" />
            <select v-else class="set-select" :value="String(config[field.key] ?? field.default)"
              @change="onConfig(field.key, ($event.target as HTMLSelectElement).value)">
              <option v-for="o in field.options" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
          <div class="set-hint">配置项由各形态自己声明（`configSchema`），这里只按声明渲染——新增形态不必改本面板。</div>
        </template>
      </div>
    </template>
  </CardDeck>
</template>

<script setup lang="ts">
/**
 * 设置 ·「实体详情」Tab（批次 1b-2）。详细见
 * docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §7.1
 *
 * 本面板只做**类型级覆写**的读写，且一律走 `useDetailLayout` ——不在这里再拼一遍三级合并，
 * 否则详情面与设置面会各算出一个「当前形态」（1a 的四套控件就是这么长出来的）。
 * 实现放本仓 app 侧而不是 ui-kit：形态注册表在 plugin-sdk，而 plugin-sdk 依赖 ui-kit，
 * 面板若进 ui-kit 就成了包间环。
 */
import { computed, ref } from 'vue'
import { entitySchemaRegistry, fieldRegistry, useDetailLayoutStore } from '@worldsea/entity-core'
import { CardDeck, WsIcon, matchKeywords, toastSuccess, useConfirm } from '@worldsea/ui-kit'
import {
  allContentForms,
  getContentForm,
  resolveContentConfig,
  useDetailLayout,
  type ContentConfigField,
} from '@worldsea/plugin-sdk'

const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ 'card-change': [index: number] }>()

const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)
defineExpose({ goToCard: (i: number) => deckRef.value?.goToCard(i) })

const forms = allContentForms()
const store = useDetailLayoutStore()

/** 可配置的类型＝已注册字段的类型 ∪ 已有覆写的类型（后者保证「设过就能找到并清掉」） */
const types = computed(() => {
  const keys = new Set<string>([...fieldRegistry.getEntityTypes(), ...Object.keys(store.overrides)])
  return [...keys].sort().map(key => ({ key, label: entitySchemaRegistry.getLabel(key) || key }))
})

const selectedType = ref('')
const activeType = computed(() => selectedType.value || types.value[0]?.key || '')

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}

const fieldMetas = computed(() => fieldRegistry.getFields(activeType.value))
const { layout, setOrder, toggleHidden, setContentForm, setContentConfig, reset } = useDetailLayout(
  activeType,
  () => fieldMetas.value.map(f => f.key),
)

const typeLabel = computed(() => entitySchemaRegistry.getLabel(activeType.value) || activeType.value)
/** 有覆写才给「恢复芽默认」——没覆写时这个按钮是个假动作 */
const hasOverride = computed(() => Object.keys(store.overrides[activeType.value] ?? {}).length > 0)

const rows = computed(() => layout.value.order
  .map(key => {
    const f = fieldMetas.value.find(x => x.key === key)
    return { key, label: f?.label || key, hidden: layout.value.hidden.includes(key) }
  }))

const activeDef = computed(() => getContentForm(layout.value.contentForm) ?? getContentForm('grouped'))
const formLabel = computed(() => activeDef.value?.label || layout.value.contentForm)
const configSchema = computed<ContentConfigField[]>(() => activeDef.value?.configSchema ?? [])
const config = computed(() => resolveContentConfig(layout.value.contentForm, layout.value.contentConfig))

function onPickForm(form: string) {
  setContentForm(form)
}

function move(key: string, delta: number) {
  const list = [...layout.value.order]
  const from = list.indexOf(key)
  const to = from + delta
  if (from < 0 || to < 0 || to >= list.length) return
  list.splice(from, 1)
  list.splice(to, 0, key)
  setOrder(list)
}

function toggle(key: string) {
  toggleHidden(key)
}

function onConfig(key: string, value: unknown) {
  setContentConfig({ ...layout.value.contentConfig, [key]: value })
}

/** 布尔项翻的是**当前有效值**（默认由注册表兜），不是事件里 DOM 的 checked——
 *  `:checked` 是单向绑定，DOM 状态与存储状态在程序化触发下会分家 */
function onConfigBool(key: string) {
  onConfig(key, config.value[key] === false)
}

/** number 输入走 event 对象：直接取 target.value 再回落默认值（清空时不等于 0） */
function onConfigInput(field: ContentConfigField, e: Event) {
  const raw = (e.target as HTMLInputElement).value
  onConfig(field.key, raw === '' ? field.default : Number(raw))
}

const { confirm } = useConfirm()

async function restoreSproutDefault() {
  const ok = await confirm({
    type: 'danger',
    title: '恢复芽默认',
    description: `确定清除「${typeLabel.value}」的详情覆写吗？形态、字段顺序与可见性、形态配置都会回到芽声明。`,
  })
  if (!ok) return
  reset()
  toastSuccess('已恢复芽默认布局')
}
</script>

<style scoped>
/* 基座样式（.set-card/.sc-head/.set-row/.set-chip/.set-toggle/.set-hint）见 ui-kit settings-panels.css */
.ds-type { margin-left: auto; font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); font-weight: normal; }
.ds-field { align-items: center; gap: 8px; }
.ds-order { width: 18px; text-align: right; font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); font-family: monospace; flex-shrink: 0; }
.ds-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ds-label.is-hidden { color: var(--text-tertiary, var(--color-text-tertiary)); text-decoration: line-through; }
.ds-key { font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); font-family: monospace; flex-shrink: 0; }
.ds-acts { display: inline-flex; gap: 2px; flex-shrink: 0; }
.ds-btn {
  width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm);
  background: var(--bg, var(--color-bg-surface)); color: var(--text-color); cursor: pointer; font-size: var(--font-size-xs);
}
.ds-btn:hover:not(:disabled) { border-color: var(--primary, var(--color-primary)); color: var(--primary, var(--color-primary)); }
.ds-btn:disabled { opacity: 0.35; cursor: default; }

.set-select, .set-input {
  padding: 4px 8px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border));
  border-radius: var(--radius-sm); background: var(--bg, var(--color-bg-surface)); color: var(--text-color); cursor: pointer;
}
.set-input-sm { width: 72px; text-align: center; cursor: text; }
.set-select:focus, .set-input:focus { outline: none; border-color: var(--primary, var(--color-primary)); }
.set-chip-group { display: flex; gap: 6px; flex-wrap: wrap; }
.set-chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px;
  border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-lg);
  font-size: var(--font-size-sm); cursor: pointer; background: var(--bg, var(--color-bg-surface)); color: var(--text-color);
}
.set-chip.on { border-color: var(--primary, var(--color-primary)); color: var(--primary, var(--color-primary)); background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); }
.set-btn-row { display: flex; gap: 8px; margin-top: 6px; }
.set-btn {
  font-size: var(--font-size-sm); padding: 6px 14px; border-radius: var(--radius-sm);
  border: 1px solid var(--border, var(--color-border)); background: var(--bg, var(--color-bg-surface));
  color: var(--text-color); cursor: pointer;
}
.set-btn:hover { border-color: var(--primary, var(--color-primary)); background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); }
</style>
