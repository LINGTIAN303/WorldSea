<template>
  <CardDeck :count="7" :flat="!!searchQuery" ref="deckRef" @change="(i) => emit('card-change', i)">
    <template #card="{ idx, cls }">
      <div class="set-card deck-card ds-panel" :class="cls" :data-index="idx" v-show="match(CARD_KEYS[idx] ?? '')">

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
          <div class="set-hint">
            标题固定在头部不占行；新增字段自动补在末尾，不会被旧覆写吞掉。
            <template v-if="presetNames.length">当前基准序来自预设「{{ activePreset }}」，本卡的移动是在它之上再覆写一层。</template>
          </div>
        </template>

        <!-- ③ 形态配置（按当前形态的 configSchema 自动渲染） -->
        <template v-else-if="idx === 2">
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

        <!-- ④ 分组管理（草稿在子件，落盘走本件的 setGroups） -->
        <template v-else-if="idx === 3">
          <DetailGroupsCard :groups="groupSeed" :fields="groupables" :type-label="typeLabel" @commit="onGroupsCommit" />
        </template>

        <!-- ⑤ 命名预设（字段基准序的多套档） -->
        <template v-else-if="idx === 4">
          <div class="sc-head"><span>命名预设</span><span class="ds-type">{{ typeLabel }}</span></div>
          <div v-for="name in presetNames" :key="name" class="set-row ds-field">
            <span class="ds-label" :class="{ 'is-active': name === activePreset }">{{ name }}</span>
            <span class="ds-count">{{ (presetOrder(name) ?? []).length }} 字段</span>
            <span class="ds-acts">
              <button v-if="name !== activePreset" class="ds-btn ds-btn-wide" type="button" @click="applyPreset(name)">应用</button>
              <button v-if="name !== '默认'" class="ds-btn" type="button" title="删除预设" aria-label="删除预设"
                @click="dropPreset(name)"><WsIcon name="delete" size="xs" /></button>
            </span>
          </div>
          <div v-if="!presetNames.length" class="set-hint">该类型还没有预设。</div>

          <div class="set-row">
            <input class="set-input" v-model="newPresetName" placeholder="新预设名" aria-label="新预设名" />
            <button class="set-btn" type="button" @click="saveNewPreset">存当前顺序</button>
          </div>
          <div class="set-hint">
            预设**只管字段的基准序**：字段本身是类型级的（在详情里增删、在上一卡分组），
            应用预设不会加字段也不会删字段。详情面若设过顺序覆写，覆写排在基准序之上。
          </div>
        </template>

        <!-- ⑥ 承载形态（L1：详情装在哪种容器里） -->
        <template v-else-if="idx === 5">
          <div class="sc-head"><span>承载形态</span><span class="ds-type">{{ typeLabel }}</span></div>
          <div class="set-row"><span>详情容器</span>
            <div class="set-chip-group">
              <button v-for="c in carrierDefs" :key="c.carrier" type="button" class="set-chip"
                :class="{ on: c.carrier === carrierValue }" :title="c.description" @click="pickCarrier(c.carrier)">
                <WsIcon :name="c.icon" size="xs" /><span>{{ c.label }}</span>
              </button>
            </div>
          </div>
          <div class="set-hint">
            载体与编排是两级：换容器不动你在「内容形态」里选的编排。
            {{ carrierHint }}
          </div>
          <!-- 遮罩行为两层：全局默认 + 本类型覆写（只存明确选过的，清掉即回到全局） -->
          <div class="set-row"><span>遮罩行为（全局默认）</span>
            <div class="set-chip-group">
              <button v-for="b in backdropModes" :key="b.value" type="button" class="set-chip"
                :class="{ on: store.backdropMode === b.value }" :title="b.description"
                @click="store.backdropMode = b.value">
                <WsIcon :name="b.icon" size="xs" /><span>{{ b.label }}</span>
              </button>
            </div>
          </div>
          <div class="set-row"><span>本类型遮罩</span>
            <div class="set-chip-group">
              <button type="button" class="set-chip" :class="{ on: !backdropSet }"
                title="跟随全局默认" @click="clearBackdropType">跟随全局</button>
              <button v-for="b in backdropModes" :key="b.value" type="button" class="set-chip"
                :class="{ on: backdropSet && backdropTypeValue === b.value }" :title="b.description"
                @click="store.setBackdropOverride(activeType, b.value)">
                <WsIcon :name="b.icon" size="xs" /><span>{{ b.label }}</span>
              </button>
            </div>
          </div>
          <div class="set-hint">
            遮罩只管浮层载体（抽屉）拦不拦点击；「拦截」＝点空白处关闭抽屉，「穿透」＝抽屉开着仍能直接点列表。
            分栏载体在流内、没有遮罩，这两档对它无作用。
          </div>
          <div v-if="carrierSet" class="set-btn-row">
            <button class="set-btn" type="button" @click="clearCarrier">回到芽声明（当前未设＝右栏抽屉）</button>
          </div>
        </template>

        <!-- ⑦ Tab 管理（顺序/隐藏；「信息」「关联」钉底禁隐——2026-10-08 Tab 优化批 C） -->
        <template v-else>
          <DetailTabsCard :entity-type="activeType" :type-label="typeLabel" />
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
import { entitySchemaRegistry, fieldRegistry, useDetailLayoutStore, useFieldOrderStore } from '@worldsea/entity-core'
import { CardDeck, WsIcon, matchKeywords, toastSuccess, useConfirm } from '@worldsea/ui-kit'
import DetailGroupsCard from './DetailGroupsCard.vue'
import DetailTabsCard from './DetailTabsCard.vue'
import '../detail-settings.css'
import {
  DEFAULT_CARRIER,
  OTHER_GROUP,
  allCarriers,
  allContentForms,
  activeCarrier,
  getContentForm,
  resolveContentConfig,
  useDetailLayout,
  type ContentConfigField,
  type DetailGroup,
} from '@worldsea/plugin-sdk'

/** 合成组「其它」的 key——它不是真分组，不能当草稿种子 */
const OTHER_GROUP_KEY = OTHER_GROUP.key

/** 每卡的搜索关键词（第 5 位＝命名预设卡） */
const CARD_KEYS = [
  '实体 详情 形态 内容形态 默认 分组 表格 段落 摘要 时间轴 form detail',
  '实体 详情 字段 顺序 排序 可见 隐藏 上移 下移 field order hidden',
  '实体 详情 形态 配置 属性数 摘录 描述 创建时间 config',
  '实体 详情 分组 分组管理 组名 归属 未分组 group',
  '实体 详情 预设 命名预设 基准序 另存为 preset',
  '实体 详情 载体 承载形态 抽屉 栏式 分栏 遮罩 穿透 拦截 backdrop carrier column drawer',
  '实体 详情 标签页 tab 标签 排序 隐藏 位置 固定',
]

const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ 'card-change': [index: number] }>()

const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)
defineExpose({ goToCard: (i: number) => deckRef.value?.goToCard(i) })

const forms = allContentForms()
const carrierDefs = allCarriers()
/** 缺省载体的中文名从注册表取，不在这里再写一遍字面量 */
const DEFAULT_LABEL = activeCarrier(DEFAULT_CARRIER).label
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
const { layout, setOrder, setGroups, toggleHidden, setContentForm, setContentConfig, reset } = useDetailLayout(
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
    description: `确定清除「${typeLabel.value}」的详情覆写吗？形态、字段顺序与可见性、分组、形态配置都会回到芽声明。`,
  })
  if (!ok) return
  reset()
  toastSuccess('已恢复芽默认布局')
}

// ── ④ 分组：草稿在 DetailGroupsCard，本件只给种子与落盘 ───────
// 这卡唯独不即时落盘：`normalizeGroups` 会把空组丢掉，即时写会让「新建分组」点完立刻消失，像按钮坏了。
/** 可分组的字段＝非标题（标题栏承载）、非封面（「封面」Tab 承载）、未隐藏 */
const groupables = computed(() => fieldMetas.value
  .filter(f => f.key !== 'title' && f.key !== 'coverImage' && !layout.value.hidden.includes(f.key)))

/**
 * 草稿种子：存过的原样拿回（含空组）；没存过则从解析结果起，但**要剔掉合成的「其它」组**——
 * 把合成组当种子，用户第一次点「新建」就会把全部字段变成一个真组，语义正好反过来。
 */
const groupSeed = computed<DetailGroup[]>(() => {
  const stored = store.overrides[activeType.value]?.groups
  const src = stored?.length ? stored : layout.value.groups.filter(g => g.key !== OTHER_GROUP_KEY)
  return src.map(g => ({ ...g, fieldKeys: [...g.fieldKeys] }))
})

/**
 * 载体：设置面只管**用户覆写**这一层。
 * 芽声明的那一层拿不到（载体不像布局有落盘的合并源，它由各芽视图当 prop 传进来），
 * 所以这里不谎报「芽声明的是什么」，只说清未设时的行为。
 */
/**
 * 遮罩行为（全局）：抽屉这类浮层原本**不拦点击**（`.detail-backdrop` 带 `pointer-events:none`），
 * 所以"点空白关抽屉"以前是不存在的。这里把它做成一档可选行为，缺省仍是穿透。
 */
const backdropModes = [
  { value: 'passthrough' as const, label: '穿透', icon: 'move',
    description: '抽屉开着仍能直接点列表与卡片（缺省，与批次 2 之前一致）' },
  { value: 'blocking' as const, label: '拦截', icon: 'shield',
    description: '遮罩拦住列表点击，点空白处关闭抽屉' },
]

const carrierSet = computed(() => !!store.carriers[activeType.value])
const backdropSet = computed(() => !!store.backdropOverrides[activeType.value])
const backdropTypeValue = computed(() => store.backdropOverrides[activeType.value])
const carrierValue = computed(() => store.carriers[activeType.value] ?? DEFAULT_CARRIER)
const carrierHint = computed(() => carrierSet.value
  ? `当前显示的是设置里选的那一种；清掉即回到芽声明（没声明就是「${DEFAULT_LABEL}」）。`
  : `未设置＝按芽声明，芽没声明则是「${DEFAULT_LABEL}」（观感与本批改动前完全一致）。`)

function pickCarrier(carrier: string) {
  store.setCarrier(activeType.value, carrier)
}

function clearCarrier() {
  store.clearCarrier(activeType.value)
}

function clearBackdropType() {
  store.clearBackdropOverride(activeType.value)
}

function onGroupsCommit(groups: DetailGroup[]) {
  setGroups(groups)
  toastSuccess('已保存分组')
}

// ── ⑤ 命名预设：只管基准序 ─────────────────────────────────
const orderStore = useFieldOrderStore()
const presetNames = computed(() => orderStore.getPresetNames(activeType.value))
const activePreset = computed(() => orderStore.getActivePreset(activeType.value))

function presetOrder(name: string): string[] {
  return orderStore.getPresetOrder(activeType.value, name) ?? []
}

function applyPreset(name: string) {
  orderStore.loadPreset(activeType.value, name)
  toastSuccess(`已应用预设「${name}」的基准序`)
}

async function dropPreset(name: string) {
  const ok = await confirm({
    type: 'warning',
    title: '删除预设',
    description: `确定删除「${typeLabel.value}」的预设「${name}」吗？字段本身与详情覆写都不受影响。`,
  })
  if (!ok) return
  orderStore.deletePreset(activeType.value, name)
  toastSuccess(`已删除预设「${name}」`)
}

const newPresetName = ref('')

function saveNewPreset() {
  const name = newPresetName.value.trim()
  if (!name) return
  orderStore.savePreset(activeType.value, name, fieldMetas.value.map(f => f.key))
  newPresetName.value = ''
  toastSuccess(`已存为预设「${name}」`)
}
</script>
