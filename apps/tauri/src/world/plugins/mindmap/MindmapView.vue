<template>
  <div class="mindmap-view">
    <!-- 左侧：导图文档列表（可折叠；收起后只留展开钮） -->
    <aside class="mmv-sidebar" :class="{ collapsed: sidebarCollapsed }">
      <div class="mmv-side-head">
        <template v-if="!sidebarCollapsed">
          <span class="mmv-side-title">思维导图</span>
          <button class="mmv-icon-act" title="收起侧栏" @click="sidebarCollapsed = true"><WsIcon name="chevron-left" size="xs" /></button>
        </template>
        <button v-else class="mmv-icon-act" title="展开侧栏" @click="sidebarCollapsed = false"><WsIcon name="chevron-right" size="xs" /></button>
      </div>
      <template v-if="!sidebarCollapsed">
        <div class="mmv-side-tools">
          <button class="mmv-tool-btn" title="新建空白导图" @click="onCreateDoc"><WsIcon name="plus" size="xs" /></button>
          <button class="mmv-tool-btn" title="导入 Markdown 大纲为新导图" @click="onImportFile"><WsIcon name="upload" size="xs" /></button>
          <button class="mmv-tool-btn" title="导出当前导图为 Markdown" :disabled="!store.currentId" @click="onExportMd"><WsIcon name="download" size="xs" /></button>
          <button class="mmv-tool-btn" title="导出当前导图为 PNG 图片" :disabled="!store.currentId" @click="onExportImage('png')"><WsIcon name="image-down" size="xs" /></button>
          <button class="mmv-tool-btn" title="导出当前导图为 SVG 矢量图" :disabled="!store.currentId" @click="onExportImage('svg')"><WsIcon name="file-down" size="xs" /></button>
        </div>
        <div class="mmv-side-template">
          <CustomDropdown
            :model-value="templatePick"
            :options="templateOptions"
            placeholder="从模板新建…"
            class="mmv-template-dd"
            @update:model-value="onCreateFromTemplate"
          />
        </div>
        <ul class="mmv-doc-list">
          <li
            v-for="d in store.sortedDocs"
            :key="d.id"
            class="mmv-doc-item"
            :class="{ active: d.id === store.currentId }"
            @click="openDoc(d.id)"
          >
            <template v-if="renamingId === d.id">
              <input
                ref="renameInputRef"
                v-model="renameText"
                class="mmv-rename-input"
                maxlength="40"
                @click.stop
                @keyup.enter="commitRename(d.id)"
                @keyup.esc="renamingId = null"
                @blur="commitRename(d.id)"
              />
            </template>
            <template v-else>
              <span class="mmv-doc-name" :title="d.name">{{ d.name }}</span>
              <span class="mmv-doc-actions">
                <span role="button" class="mmv-doc-act" title="重命名" @click.stop="startRename(d)"><WsIcon name="edit" size="xs" /></span>
                <span role="button" class="mmv-doc-act danger" title="删除导图" @click.stop="onDeleteDoc(d)"><WsIcon name="delete" size="xs" /></span>
              </span>
            </template>
          </li>
        </ul>
        <div class="mmv-side-foot">
          <WsInlineLoading v-if="store.saveState === 'saving'" size="sm" label="正在保存导图" />
          <span>{{ saveStateText }}</span>
        </div>
      </template>
    </aside>

    <!-- 主区：mind-elixir 画布 -->
    <div ref="mainEl" class="mmv-main">
      <div ref="mapEl" class="mmv-map" :inert="mindLoading || undefined"></div>
      <WsLoadingOverlay
        :show="mindLoading"
        scope="panel"
        title="正在打开导图"
        success-title="导图已就绪"
        error-title="导图载入失败"
        :stages="MINDMAP_LOAD_STAGES"
        :current="mindStage"
        :status="mindStatus"
        :error="mindError ?? ''"
        error-text="无法载入导图数据"
        :closable="false"
        @retry="initializeMindmap"
      />
      <WsEmpty v-if="mindLoaded && store.currentId === null" title="没有导图" description="点击左侧「新建」创建第一张导图">
        <template #icon><WsIcon name="mindmap" size="xl" /></template>
      </WsEmpty>

      <!-- 备注悬浮预览：hover 有备注（✎）的节点时显示 -->
      <Transition name="ws-scale-fade">
        <div
          v-if="noteTip"
          class="mmv-note-tip"
          :class="{ below: noteTip.below }"
          :style="{ left: noteTip.x + 'px', top: noteTip.y + 'px' }"
        >{{ noteTip.text }}</div>
      </Transition>

      <!-- 节点搜索浮框：匹配 topic → 选中并居中 -->
      <div v-if="store.currentId !== null" class="mmv-search">
        <WsIcon name="search" size="xs" class="mmv-search-icon" />
        <input
          v-model="searchQuery"
          class="mmv-search-input"
          placeholder="搜索节点…"
          @blur="searchQuery = ''"
          @keydown.enter.prevent="onSearchEnter"
          @keydown.esc="searchQuery = ''"
        />
        <ul v-if="searchQuery && searchResults.length > 0" class="mmv-search-results">
          <li
            v-for="(r, i) in searchResults"
            :key="r.id"
            :class="{ 'is-hover': i === searchHoverIndex }"
            @mouseenter="searchHoverIndex = i"
            @mousedown.prevent="locateNode(r)"
          >
            <span class="mmv-search-topic">{{ r.topic }}</span>
            <span v-if="r.parentTopic" class="mmv-search-parent">{{ r.parentTopic }}</span>
          </li>
        </ul>
        <div v-else-if="searchQuery && searchResults.length === 0" class="mmv-search-empty">无匹配节点</div>
      </div>

      <!-- 绑定面板：选中节点时浮现 -->
      <Transition name="ws-scale-fade">
        <div v-if="selectedObj" class="mmv-bind-panel">
          <div class="mmv-bind-head">
            <span class="mmv-bind-topic">{{ selectedObj.topic }}</span>
            <button class="mmv-bind-close" title="关闭" @click="clearSelection"><WsIcon name="x" size="xs" /></button>
          </div>
          <div class="mmv-bind-row">
            <span class="mmv-bind-label">绑定实体</span>
            <CustomDropdown
              :model-value="boundEntityId ?? ''"
              :options="entityOptions"
              placeholder="选择实体…"
              class="mmv-bind-dd"
              @update:model-value="onBindEntity"
            />
          </div>
          <div v-if="boundEntity" class="mmv-bind-row mmv-bind-linked">
            <WsIcon name="link" size="xs" />
            <span class="mmv-bind-entity">{{ boundEntity.name }}</span>
            <button class="mmv-bind-btn primary" @click="goToEntity(boundEntity)"><WsIcon name="arrow-right" size="xs" /> 前往</button>
            <button class="mmv-bind-btn" @click="onUnbind">解绑</button>
          </div>
          <div class="mmv-bind-row">
            <span class="mmv-bind-label">节点图片</span>
            <button class="mmv-bind-btn" @click="onImageFile">插入…</button>
            <button v-if="selectedObj?.image" class="mmv-bind-btn" @click="onRemoveImage">移除</button>
          </div>
          <div class="mmv-bind-note-row">
            <span class="mmv-bind-label">备注</span>
            <textarea
              v-model="noteDraft"
              class="mmv-note-input"
              rows="2"
              placeholder="补充说明…（失焦自动保存，节点上以 ✎ 标记）"
              @blur="commitNote"
            />
          </div>
          <p class="mmv-bind-hint">绑定后，构思成熟的想法可随时跳到对应芽落地为完整实体。</p>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import MindElixir from 'mind-elixir'
import 'mind-elixir/style'
import type { NodeObj, MindElixirData, MindElixirInstance } from 'mind-elixir'
import { WsIcon, WsEmpty, WsInlineLoading, WsLoadingOverlay, useAsyncTask, toastSuccess, toastWarn, type LoadingStage, type LoadingStatus } from '@worldsea/ui-kit'
import { useEntityStore, useUIStore, type Entity } from '@worldsea/entity-core'
import { CustomDropdown, useConfirm } from '@worldsea/plugin-sdk'
import { useMindmapDocStore } from './mindmapStore'
import { markdownToMindElixir, mindElixirToMarkdown, findImportViolation, mindElixirStats, MINDMAP_MAX_NODES, MINDMAP_MAX_DEPTH, MINDMAP_OPEN_MAX_NODES, MINDMAP_OPEN_MAX_DEPTH } from './mindmapMarkdown'
import { pickLocalFiles } from '@/composables/pickLocalFiles'

/** 节点绑定实体的元数据载体（mind-elixir 官方通用 metadata 字段） */
interface NodeMeta { entityId?: string }

const BIND_TAG_PREFIX = '⧉'

/** 备注徽章：note 内容存 NodeObj.note（官方字段，引擎不渲染），节点上以此徽章提示「有备注」 */
const NOTE_TAG = '✎'

/** mind-elixir 右键菜单中文文案（LangPack 结构；引擎默认英文且未导出 i18n 包） */
const MENU_LOCALE = {
  addChild: '插入子节点',
  addParent: '插入父节点',
  addSibling: '插入同级节点',
  removeNode: '删除节点',
  focus: '专注',
  cancelFocus: '取消专注',
  moveUp: '上移',
  moveDown: '下移',
  link: '连接线',
  linkBidirectional: '双向连接',
  clickTips: '请点击目标节点',
  summary: '概要',
}

const store = useMindmapDocStore()
const entityStore = useEntityStore()
const uiStore = useUIStore()
const { confirm } = useConfirm()

const mapEl = ref<HTMLElement | null>(null)
let mind: MindElixirInstance | null = null

/** 首载两段：文档索引与画布；overlay 只盖主区，侧栏文档列表保持可见 */
const MINDMAP_LOAD_STAGES: LoadingStage[] = [
  { short: '索引', full: '载入导图索引' },
  { short: '画布', full: '展开导图画布' },
]
const { visible: mindLoading, status: mindLoadStatus, error: mindError, run: runMindmapLoad } = useAsyncTask({ successHold: 0 })
const mindStage = ref(0)
const mindLoaded = ref(false)
const mindStatus = computed<LoadingStatus>(() => {
  if (mindLoadStatus.value === 'error') return 'error'
  if (mindLoadStatus.value === 'success' || mindLoadStatus.value === 'empty') return 'success'
  return 'loading'
})

/** 当前选中的节点对象（单选；多选场景取第一个） */
const selectedObj = ref<NodeObj | null>(null)

/** 重命名状态 */
const renamingId = ref<string | null>(null)
const renameText = ref('')
const renameInputRef = ref<HTMLInputElement[]>([])

/** 侧栏折叠（收起只留展开钮，画布全宽；会话内状态不持久化） */
const sidebarCollapsed = ref(false)

const saveStateText = computed(() => {
  if (store.saveState === 'saving') return '保存中…'
  if (store.saveState === 'saved') return '已保存'
  return ''
})

/** 实体下拉选项：全部实体，label = 「名称（类型）」 */
const entityOptions = computed(() =>
  entityStore.entities.map(e => ({ value: e.id, label: `${e.name}（${e.type}）` })),
)

const boundEntityId = computed(() => (selectedObj.value?.metadata as NodeMeta | undefined)?.entityId ?? null)
const boundEntity = computed<Entity | null>(() =>
  boundEntityId.value ? entityStore.entities.find(e => e.id === boundEntityId.value) ?? null : null,
)

/* ── 画布实例管理 ── */

/** 打开指定文档：首张 init，切换 refresh（clearHistory 防止跨文档撤销）；重复点击当前文档不重建 */
function openDoc(id: string) {
  if (id === store.currentId && mind) return
  const data = store.getDocData(id)
  if (!data || !mapEl.value) return
  // 加载护栏：只挡真正会崩的旧数据（千层链 / 超大图），正常导图不受影响——
  // 拦截时不切 currentId，画布保留当前文档；问题导图可从文档列表删除
  const stats = mindElixirStats(data)
  if (stats.nodeCount > MINDMAP_OPEN_MAX_NODES || stats.maxDepth > MINDMAP_OPEN_MAX_DEPTH) {
    toastWarn(`导图「${store.docs.find(d => d.id === id)?.name ?? id}」超出渲染安全上限（节点 ${stats.nodeCount}、层级 ${stats.maxDepth}），已阻止打开；可能为旧版导入产物，可在文档列表删除。`)
    return
  }
  store.currentId = id
  if (!mind) {
    mind = new MindElixir({
      el: mapEl.value,
      direction: MindElixir.SIDE,
      editable: true,
      // 右键菜单汉化（Link 连接线 / Summary 概要 / Focus 专注等能力内建其中）
      contextMenu: { focus: true, link: true, locale: MENU_LOCALE },
      toolBar: true,
      keypress: true,
      allowUndo: true,
      newTopicName: '新节点',
      // 主题令牌适配：CSS 变量在模板样式覆盖（跟随底色×强调色两轴）；
      // palette 只放分支色环（消费点 = 一级分支描边+主线色，不影响节点底/文字）。
      // 注意不可调 changeTheme——它会把内置主题 cssVar 以 inline 写入容器，踩掉映射。
      theme: { name: 'WorldSea', palette: buildPalette() },
    })
    // 粘贴 Markdown 大纲 → 选中节点下落成子树（剪贴板非引擎内部节点时触发）
    mind.pasteHandler = onPasteMarkdown
    registerBusHandlers(mind)
    mind.init(data)
    // init 内部会调 changeTheme 把内置主题 cssVar 以 inline style 写进容器，
    // 踩掉模板的两轴 CSS 变量映射（暗色下画布呈内置亮色）——清掉交给映射接管
    stripInlineThemeVars()
    // 框选偏移修复：引擎内嵌 viselect 的框选矩形为 fixed 定位，其包含块在本
    // 环境 DOM 下发生偏移（框与指针错位、右下角钉在起点）。禁用它，由自绘
    // 框选接管（absolute + 实时 containerRect 换算，见 onCanvasPointerDown）。
    mind.selection?.disable()
    mind.container.addEventListener('pointerdown', onCanvasPointerDown)
  } else {
    mind.refresh(data)
    mind.clearHistory?.()
    // refresh 不应用文档方向（direction 会残留上一文档）——按文档数据校正
    const dir = data.direction
    if (dir === MindElixir.LEFT) mind.initLeft()
    else if (dir === MindElixir.RIGHT) mind.initRight()
    else if (dir === MindElixir.DOWN) mind.initDown()
    else mind.initSide()
  }
  selectedObj.value = null
}

/** 清除 init 写入容器的 inline 主题变量（见 openDoc 注释）。
 *  仅清颜色/样式类（:deep 映射已覆盖）；布局间距类必须保留引擎 inline 默认值——
 *  引擎 CSS 文件对这些变量零定义，清掉后 margin/padding 的 var() 落空，
 *  节点布局塌缩、连接线端点全错（09-14 真机实锤：线飞散/切文档丢线）。 */
const KEEP_LAYOUT_VARS = new Set([
  '--node-gap-x', '--node-gap-y', '--main-gap-x', '--main-gap-y',
  '--map-padding', '--topic-padding', '--main-radius', '--root-radius',
])

function stripInlineThemeVars() {
  if (!mind) return
  for (const prop of Array.from(mind.container.style)) {
    if (prop.startsWith('--') && !KEEP_LAYOUT_VARS.has(prop)) {
      mind.container.style.removeProperty(prop)
    }
  }
}

/** 注册画布事件：操作 → 防抖自动保存；选中 → 更新绑定面板 */
function registerBusHandlers(instance: MindElixirInstance) {
  instance.bus.addListener('operation', () => scheduleSave())
  instance.bus.addListener('selectNewNode', (obj: NodeObj) => { selectedObj.value = obj })
  instance.bus.addListener('selectNodes', (objs: NodeObj[]) => { selectedObj.value = objs[0] ?? null })
  instance.bus.addListener('unselectNodes', () => { selectedObj.value = null })
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
/** 防抖自动保存（operation 高频触发，800ms 静默后落盘） */
function scheduleSave() {
  const currentId = store.currentId
  if (!mind || !currentId) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (!mind) return
    store.persistDocData(currentId, mind.getData() as MindElixirData)
  }, 800)
}

function clearSelection() {
  try { mind?.clearSelection() } catch { /* ignore */ }
  selectedObj.value = null
}

/* ── 分支配色（跟随强调色的色环）── */

/** hex → HSL（h 0-360，s/l 0-100）；非 hex 输入返回 null */
function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const int = parseInt(m[1], 16)
  const r = (int >> 16 & 255) / 255, g = (int >> 8 & 255) / 255, b = (int & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  return { h, s: s * 100, l: l * 100 }
}

function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(c * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** 读当前强调色（--accent），生成一级分支配色：8 色环，强调色为首色 */
function buildPalette(): string[] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent')
  const base = hexToHsl(raw) ?? hexToHsl('#4a6cf7')!
  // S/L 收敛到柔和区间：分支线在明暗底上都清晰，且不过分抢眼
  const s = Math.min(65, Math.max(45, base.s))
  const l = Math.min(68, Math.max(58, base.l))
  const offsets = [0, 40, -40, 80, -80, 145, -145, 180]
  return offsets.map(o => hslToHex((base.h + o + 360) % 360, s, l))
}

/** 主题两轴联动：强调色变化时重生成分支配色并重绘线条（绕开 changeTheme 保住 CSS 变量映射） */
function onThemeChanged() {
  if (!mind) return
  mind.theme = { ...mind.theme, palette: buildPalette() }
  try { mind.linkDiv() } catch { /* ignore */ }
}

/* ── 粘贴 Markdown 大纲 → 子树 ── */

/**
 * 从外部（如笔记芽、编辑器）复制 MD 大纲后，在导图内直接 Ctrl+V——
 * 大纲落成当前选中节点的子分支。非大纲文本（解析不出列表）不拦截，走浏览器默认。
 */
async function onPasteMarkdown(e: ClipboardEvent) {
  if (!mind) return
  const text = e.clipboardData?.getData('text/plain')
  if (!text) return
  const parsed = markdownToMindElixir(text)
  const tops = parsed?.nodeData.children
  if (!tops || tops.length === 0) return
  // 深度护栏：md 级检查 + 与当前文档合并后的节点规模（粘贴会展开为当前文档的一部分，超限整单拒绝）
  const violation = findImportViolation(text)
  const current = mindElixirStats(mind.getData() as MindElixirData)
  const pasted = mindElixirStats({ nodeData: { id: 'paste-guard', topic: '', children: tops } } as MindElixirData)
  if (violation || current.nodeCount + pasted.nodeCount > MINDMAP_MAX_NODES) {
    e.preventDefault()
    toastWarn(violation ?? `粘贴取消：粘贴后节点 ${current.nodeCount + pasted.nodeCount} 超上限 ${MINDMAP_MAX_NODES}`)
    return
  }
  const target = mind.currentNode
  if (!target) {
    e.preventDefault()
    toastWarn('先选中一个节点，再粘贴大纲')
    return
  }
  e.preventDefault()
  for (const top of tops) {
    await mind.addChild(target, top as NodeObj)
  }
  scheduleSave()
  toastSuccess(`已粘贴 ${tops.length} 个分支到「${target.nodeObj.topic}」`)
}

/* ── 文档列表操作 ── */

function onCreateDoc() {
  const id = store.createDoc(`导图 ${store.docs.length + 1}`)
  openDoc(id)
  toastSuccess('已新建导图')
}

/* ── 模板 / Markdown 导入导出 ── */

/** 内建模板（Markdown 大纲；经 markdownToMindElixir 落成导图） */
const TEMPLATES: { label: string; name: string; markdown: string }[] = [
  {
    label: '角色构思',
    name: '角色构思',
    markdown: `# 新角色
- 外形
  - 相貌特征
  - 着装风格
- 性格
  - 核心特质
  - 内在矛盾
- 背景
  - 出身与经历
  - 关键转折事件
- 关系
  - 盟友
  - 敌对
- 成长弧线
  - 起点状态
  - 终点状态`,
  },
  {
    label: '故事线',
    name: '故事线',
    markdown: `# 新故事线
- 第一幕 · 开端
  - 日常状态
  - 激励事件
- 第二幕 · 对抗
  - 递进冲突
  - 至暗时刻
- 第三幕 · 结局
  - 高潮对决
  - 尾声与余波`,
  },
  {
    label: '世界观分支',
    name: '世界观分支',
    markdown: `# 世界构思
- 地理
  - 大陆与区域
  - 气候与奇观
- 种族与物种
- 势力与冲突
- 历史纪元
  - 远古
  - 近世
- 力量体系
  - 力量来源
  - 等级与代价`,
  },
  {
    label: '章节大纲',
    name: '章节大纲',
    markdown: `# 章节大纲
- 第一章
  - 场景与视点
  - 本章钩子
- 第二章
  - 场景与视点
  - 本章钩子
- 第三章
  - 场景与视点
  - 本章钩子`,
  },
]

const templateOptions = TEMPLATES.map((t, i) => ({ value: String(i), label: t.label }))
const templatePick = ref('')

function onCreateFromTemplate(v: string) {
  templatePick.value = ''
  const tpl = TEMPLATES[Number(v)]
  if (!tpl) return
  const data = markdownToMindElixir(tpl.markdown)
  if (!data) return
  const id = store.createDoc(tpl.name)
  // 用模板树覆盖 createDoc 的默认空白树
  const meta = store.docs.find(d => d.id === id)
  if (meta) store.persistDocData(id, data as MindElixirData)
  openDoc(id)
  toastSuccess(`已从模板「${tpl.label}」创建导图`)
}

/** 导入 Markdown 文件 → 新导图（自绘选择器选路径，再读文本） */
async function onImportFile() {
  const picked = await pickLocalFiles({
    multiple: false,
    title: '导入 Markdown 大纲',
    filters: [{ name: 'Markdown / 文本', extensions: ['md', 'markdown', 'txt'] }],
  })
  const file = picked.files[0]
  if (!file) {
    if (!picked.cancelled) toastWarn(picked.reasons[0] ?? '文件读取失败')
    return
  }
  const md = await file.text()
  const name = file.name.replace(/\.(md|markdown|txt)$/i, '')
  // 深度护栏：超限文本提供「仅标题」逃生门（数据在 init 前已落库，导入后崩溃会锁死视图）
  const violation = findImportViolation(md)
  if (!violation) {
    const data = markdownToMindElixir(md)
    if (!data) return void toastSuccess('文件为空或无法解析出大纲结构')
    const id = store.createDoc(name)
    store.persistDocData(id, data as MindElixirData)
    openDoc(id)
    return void toastSuccess(`已导入「${name}」`)
  }
  const fallback = markdownToMindElixir(md, { headingsOnly: true })
  const stats = fallback ? mindElixirStats(fallback) : null
  if (!stats || stats.nodeCount === 0 || stats.nodeCount > MINDMAP_MAX_NODES || stats.maxDepth > MINDMAP_MAX_DEPTH) {
    return void toastWarn(`导入取消：${violation}（仅标题模式也无法收纳该文件）`)
  }
  const useHeadings = await confirm({
    type: 'warning',
    title: '文件超出渲染上限',
    description: `${violation}。可改用「仅标题」模式：只取标题行共 ${stats.nodeCount} 节点（层级 ${stats.maxDepth}），描述与字段不进入导图。`,
    confirmText: '仅标题导入',
    cancelText: '取消',
  })
  if (!useHeadings) return
  const headingsId = store.createDoc(`${name}（仅标题）`)
  store.persistDocData(headingsId, fallback as MindElixirData)
  openDoc(headingsId)
  toastSuccess(`已按「仅标题」导入「${name}」（${stats.nodeCount} 节点）`)
}

/** 通用 Blob 下载（MD / PNG / SVG 共用） */
function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** 导出当前导图为 Markdown 文件（用画布实时数据，含未保存变更） */
function onExportMd() {
  if (!mind || !store.currentMeta) return
  const md = mindElixirToMarkdown(mind.getData() as MindElixirData)
  downloadBlob(`${store.currentMeta.name}.md`, new Blob([md], { type: 'text/markdown;charset=utf-8' }))
  toastSuccess(`已导出「${store.currentMeta.name}.md」`)
}

/** 导出图片时注入画布 CSS 变量的实际值——导出产物是独立 SVG 文档，读不到页面级变量 */
const EXPORT_CSS_VARS = [
  '--main-color', '--main-bgcolor', '--color', '--bgcolor', '--selected', '--accent-color',
  '--root-color', '--root-bgcolor', '--root-border-color', '--panel-color', '--panel-bgcolor',
  '--panel-border-color', '--map-padding', '--node-gap-x', '--node-gap-y', '--main-gap-x',
  '--main-gap-y', '--topic-padding',
]

function collectMapCss(): string {
  const el = mapEl.value?.querySelector('.map-container')
  if (!el) return ''
  const cs = getComputedStyle(el)
  return EXPORT_CSS_VARS.map(v => `${v}: ${cs.getPropertyValue(v).trim()};`).join(' ')
}

/** 导出图片：PNG（异步栅格）/ SVG（矢量）；失败给出明确反馈 */
async function onExportImage(kind: 'png' | 'svg') {
  if (!mind || !store.currentMeta) return
  const css = collectMapCss()
  try {
    const blob = kind === 'png' ? await mind.exportPng(false, css) : mind.exportSvg(false, css)
    if (!blob) {
      toastWarn('导出失败：画布为空或渲染异常')
      return
    }
    downloadBlob(`${store.currentMeta.name}.${kind}`, blob)
    toastSuccess(`已导出「${store.currentMeta.name}.${kind}」`)
  } catch {
    toastWarn('导出失败：画布为空或渲染异常')
  }
}

function startRename(d: { id: string; name: string }) {
  renamingId.value = d.id
  renameText.value = d.name
  nextTick(() => renameInputRef.value?.[0]?.focus())
}

function commitRename(id: string) {
  if (renamingId.value !== id) return
  store.renameDoc(id, renameText.value)
  renamingId.value = null
}

async function onDeleteDoc(d: { id: string; name: string }) {
  const ok = await confirm({
    type: 'danger',
    title: `删除导图「${d.name}」？`,
    description: '该导图的全部节点将被删除，此操作不可撤销。',
    confirmText: '删除',
  })
  if (!ok) return
  store.deleteDoc(d.id)
  const next = store.currentId
  if (next) openDoc(next)
  toastSuccess(`已删除「${d.name}」`)
}

/* ── 节点搜索与定位 ── */

interface NodeHit { id: string; topic: string; parentTopic: string; note?: string; collapsedAncestors: string[] }

const searchQuery = ref('')
const searchHoverIndex = ref(-1)

/** 遍历导图树收集节点：父 topic 用于同名列辅助显示；收起祖先链用于定位前逐层展开 */
function collectNodes(): NodeHit[] {
  if (!mind) return []
  const hits: NodeHit[] = []
  const walk = (obj: NodeObj, parentTopic: string, collapsedAncestors: string[]) => {
    const isCollapsed = obj.expanded === false
    hits.push({ id: obj.id, topic: obj.topic, parentTopic, note: typeof obj.note === 'string' ? obj.note : undefined, collapsedAncestors })
    const nextCollapsed = isCollapsed ? [...collapsedAncestors, obj.id] : collapsedAncestors
    for (const c of obj.children ?? []) walk(c, obj.topic, nextCollapsed)
  }
  walk(mind.getData().nodeData, '', [])
  return hits
}

const searchResults = computed<NodeHit[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return []
  return collectNodes()
    .filter(n => n.topic.toLowerCase().includes(q) || (n.note?.toLowerCase().includes(q) ?? false))
    .slice(0, 10)
})

watch(searchQuery, () => {
  searchHoverIndex.value = searchResults.value.length > 0 ? 0 : -1
})

function onSearchEnter() {
  const hit = searchResults.value[Math.max(0, searchHoverIndex.value)]
  if (hit) locateNode(hit)
}

/**
 * 定位节点：收起区域内的节点无 DOM（findEle 取不到），先对收起祖先链自上而下
 * 逐层 expandNode（同步建 DOM），再选中并居中。
 */
function locateNode(hit: NodeHit) {
  if (!mind) return
  try {
    for (const aid of hit.collapsedAncestors) {
      const obj = mind.getObjById(aid, mind.nodeData)
      if (!obj || obj.expanded !== false) continue
      const ele = mind.findEle(aid)
      if (ele) mind.expandNode(ele, true)
    }
    const el = mind.findEle(hit.id)
    if (!el) return
    mind.selectNode(el)
    mind.scrollIntoView(el, true)
    searchQuery.value = ''
  } catch { /* ignore */ }
}

/* ── 画布框选（自绘；引擎 viselect 的 fixed 坐标系在本环境偏移，已禁用）── */

let selBox: HTMLDivElement | null = null
let selStart: { x: number; y: number } | null = null

/** 框选矩形：absolute 定位于画布容器内（局部坐标 = client - 实时 containerRect，天然跟手） */
function ensureSelBox(): HTMLDivElement {
  if (!selBox) {
    selBox = document.createElement('div')
    selBox.className = 'mmv-selection-box'
    mind!.container.appendChild(selBox)
  }
  return selBox
}

function onCanvasPointerDown(e: PointerEvent) {
  if (!mind || e.button !== 0 || !e.isPrimary) return
  const t = e.target as HTMLElement
  if (t.className !== 'map-container') return // 仅空白处起框（节点拖拽/平移不受影响）
  const cr = mind.container.getBoundingClientRect()
  selStart = { x: e.clientX - cr.left, y: e.clientY - cr.top }
  const box = ensureSelBox()
  box.style.display = 'block'
  box.style.left = `${selStart.x}px`
  box.style.top = `${selStart.y}px`
  box.style.width = '0px'
  box.style.height = '0px'
  window.addEventListener('pointermove', onSelMove)
  window.addEventListener('pointerup', onSelUp, { once: true })
}

function onSelMove(e: PointerEvent) {
  if (!selStart || !mind) return
  const cr = mind.container.getBoundingClientRect()
  const cx = e.clientX - cr.left
  const cy = e.clientY - cr.top
  const box = ensureSelBox()
  box.style.left = `${Math.min(selStart.x, cx)}px`
  box.style.top = `${Math.min(selStart.y, cy)}px`
  box.style.width = `${Math.abs(cx - selStart.x)}px`
  box.style.height = `${Math.abs(cy - selStart.y)}px`
}

function onSelUp(e: PointerEvent) {
  window.removeEventListener('pointermove', onSelMove)
  if (!selStart || !mind) {
    selStart = null
    return
  }
  const cr = mind.container.getBoundingClientRect()
  // 框矩形转视口坐标，与节点 rect（client）做相交判定
  const x1 = Math.min(selStart.x, e.clientX - cr.left) + cr.left
  const y1 = Math.min(selStart.y, e.clientY - cr.top) + cr.top
  const x2 = Math.max(selStart.x, e.clientX - cr.left) + cr.left
  const y2 = Math.max(selStart.y, e.clientY - cr.top) + cr.top
  selStart = null
  if (selBox) selBox.style.display = 'none'
  const hit: HTMLElement[] = []
  mind.container.querySelectorAll('me-tpc').forEach(el => {
    const r = el.getBoundingClientRect()
    if (r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1) hit.push(el as HTMLElement)
  })
  if (hit.length === 0) {
    mind.clearSelection()
    return
  }
  // Ctrl/Cmd 叠加：保留已选节点合并框选命中
  const base = e.ctrlKey || e.metaKey ? mind.currentNodes ?? [] : []
  mind.selectNodes([...new Set([...base, ...hit])] as never[])
}

/* ── 节点绑定实体 ── */

/** 绑定/换绑实体：写 metadata + tags 徽章，重渲染该节点并保存 */
function onBindEntity(entityId: string) {
  const obj = selectedObj.value
  if (!obj || !entityId || !mind) return
  const entity = entityStore.entities.find(e => e.id === entityId)
  if (!entity) return
  // 移除旧绑定徽章，写入新徽章与元数据
  const tags = (obj.tags ?? []).filter(t => typeof t === 'string' && !t.startsWith(BIND_TAG_PREFIX))
  tags.push(`${BIND_TAG_PREFIX} ${entity.name}`)
  obj.tags = tags
  obj.metadata = { ...(obj.metadata as NodeMeta | undefined), entityId }
  rerenderNodePatch(obj, { tags: obj.tags, metadata: obj.metadata })
  scheduleSave()
}

function onUnbind() {
  const obj = selectedObj.value
  if (!obj || !mind) return
  obj.tags = (obj.tags ?? []).filter(t => !(typeof t === 'string' && t.startsWith(BIND_TAG_PREFIX)))
  obj.metadata = { ...(obj.metadata as NodeMeta | undefined), entityId: undefined }
  rerenderNodePatch(obj, { tags: obj.tags, metadata: obj.metadata })
  scheduleSave()
}

/**
 * 节点对象 patch 后重渲染（reshapeNode：Object.assign 合并 + operation 事件入
 * undo 栈并触发自动保存）。patch 传显式 undefined 可删除对应字段（如图片）。
 */
function rerenderNodePatch(obj: NodeObj, patch: Partial<NodeObj>) {
  try {
    const el = mind?.findEle(obj.id)
    if (el) mind?.reshapeNode(el, patch)
  } catch {
    /* 节点可能已被删除 */
  }
}

/* ── 节点图片（NodeObj.image 内建渲染）── */

/** 插入图片：dataURL 内嵌进文档（构思用途）；宽上限 240px 等比缩放，>2MB 拒收 */
async function onImageFile() {
  const obj = selectedObj.value
  if (!obj) return
  const picked = await pickLocalFiles({
    multiple: false,
    title: '插入节点图片',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
    maxBytes: 2 * 1024 * 1024,
  })
  const file = picked.files[0]
  // 用户取消：静默返回（不可与「读了但超限」共用提示分支）
  if (!file) return void (picked.cancelled || toastWarn(picked.reasons[0] ?? '图片读取失败'))
  // 选中阶段已按 maxBytes 拦过；此处覆盖拖拽/异常路径的兜底
  if (file.size > 2 * 1024 * 1024) return void toastWarn('图片过大（超过 2MB），请压缩后再插入')
  const url = await new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(file)
  })
  const img = new Image()
  img.onload = () => {
    const w = Math.min(240, img.naturalWidth)
    const h = Math.round(img.naturalHeight * (w / img.naturalWidth))
    rerenderNodePatch(obj, { image: { url, width: w, height: h, fit: 'cover' } })
    scheduleSave()
  }
  img.src = url
}

function onRemoveImage() {
  const obj = selectedObj.value
  if (!obj) return
  rerenderNodePatch(obj, { image: undefined })
  scheduleSave()
}

/* ── 节点备注（NodeObj.note；引擎不渲染，徽章 ✎ 提示 + 面板编辑）── */

const noteDraft = ref('')

/** 选中节点切换时同步备注草稿 */
watch(selectedObj, (obj) => {
  noteDraft.value = typeof obj?.note === 'string' ? obj.note : ''
})

/** 失焦提交：有内容 = 写 note + 挂徽章；清空 = 删字段 + 摘徽章（显式 undefined 删字段） */
function commitNote() {
  const obj = selectedObj.value
  if (!obj) return
  const text = noteDraft.value.trim()
  const prev = typeof obj.note === 'string' ? obj.note : ''
  if (text === prev) return
  const tags = (obj.tags ?? []).filter(t => typeof t === 'string' && t !== NOTE_TAG)
  if (text) {
    obj.note = text
    tags.push(NOTE_TAG)
  } else {
    obj.note = undefined
  }
  obj.tags = tags
  rerenderNodePatch(obj, { note: obj.note, tags: obj.tags })
  scheduleSave()
}

/* ── 备注悬浮预览（画布 mousemove 委托）── */

const mainEl = ref<HTMLElement | null>(null)
const noteTip = ref<{ text: string; x: number; y: number; below: boolean } | null>(null)

/** hover 有备注的节点 → tooltip 悬浮预览（优先上方，空间不足放下方）；值未变时跳过赋值防高频重渲染 */
function onMapMove(e: MouseEvent) {
  const tpc = (e.target as HTMLElement | null)?.closest?.('me-tpc') as (HTMLElement & { nodeObj?: NodeObj }) | null
  const note = tpc?.nodeObj && typeof tpc.nodeObj.note === 'string' ? tpc.nodeObj.note : ''
  const host = mainEl.value
  if (!note || !tpc || !host) {
    noteTip.value = null
    return
  }
  const tr = tpc.getBoundingClientRect()
  const hr = host.getBoundingClientRect()
  const x = tr.left + tr.width / 2 - hr.left
  const above = tr.top - hr.top > 96
  const y = above ? tr.top - hr.top : tr.bottom - hr.top
  const prev = noteTip.value
  if (prev && prev.text === note && prev.x === x && prev.y === y && prev.below === !above) return
  noteTip.value = { text: note, x, y, below: !above }
}

/** 跳转到绑定实体的对应芽视图 */
function goToEntity(entity: Entity) {
  const viewMap: Record<string, string> = {
    character: 'characters', region: 'regions', event: 'timeline',
    organization: 'organizations', concept: 'concepts', item: 'items',
  }
  const viewId = viewMap[entity.type]
  if (!viewId) {
    toastSuccess(`实体「${entity.name}」暂无专属视图`)
    return
  }
  uiStore.setView(viewId)
}

/* ── 生命周期 ── */

/** Agent 侧写文档后的事件联动：刷新列表；若改的是当前打开文档则重载画布 */
function onDocsChanged(e: Event) {
  const updatedId = (e as CustomEvent).detail?.updatedId as string | undefined
  store.loadAll()
  if (updatedId && updatedId === store.currentId && mind) {
    const data = store.getDocData(updatedId)
    if (data) {
      mind.refresh(data)
      mind.clearHistory?.()
    }
  }
}

async function initializeMindmap(): Promise<void> {
  try {
    await runMindmapLoad(async () => {
      mindStage.value = 0
      await entityStore.loadAll()
      await store.loadAll()
      mindStage.value = 1
      if (store.currentId) openDoc(store.currentId)
      mindLoaded.value = true
      await nextTick()
    })
  } catch (err) {
    console.warn('[MindmapView]', err)
  }
}

onMounted(() => {
  window.addEventListener('ws-mindmap-docs-changed', onDocsChanged)
  window.addEventListener('ws-set-theme', onThemeChanged)
  mapEl.value?.addEventListener('mousemove', onMapMove)
  void initializeMindmap()
})

onBeforeUnmount(() => {
  window.removeEventListener('ws-mindmap-docs-changed', onDocsChanged)
  window.removeEventListener('ws-set-theme', onThemeChanged)
  mapEl.value?.removeEventListener('mousemove', onMapMove)
  window.removeEventListener('pointermove', onSelMove)
  mind?.container?.removeEventListener('pointerdown', onCanvasPointerDown)
  if (saveTimer) clearTimeout(saveTimer)
  // 卸载前把未落盘的变更立即保存
  const currentId = store.currentId
  if (mind && currentId) {
    store.persistDocData(currentId, mind.getData() as MindElixirData)
  }
  try { mind?.destroy() } catch { /* ignore */ }
  mind = null
})

// 暴露给调试/未来 Agent 桥接（非模板必需）
defineExpose({ getMindmapInstance: () => mind })
</script>

<style scoped>
.mindmap-view { display: flex; height: 100%; overflow: hidden; }

/* 左侧文档列表（可折叠） */
.mmv-sidebar {
  width: 220px; flex-shrink: 0; display: flex; flex-direction: column;
  border-right: 1px solid var(--border, var(--border-color));
  background: var(--bg-surface, var(--card-bg));
  transition: width var(--duration-fast, 0.15s) var(--ease-default, ease);
}
.mmv-sidebar.collapsed { width: 40px; }
.mmv-side-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 12px 8px;
}
.mmv-sidebar.collapsed .mmv-side-head { justify-content: center; padding: 12px 4px 8px; }
.mmv-side-title { font-weight: var(--font-weight-semibold); font-size: var(--font-size-sm); color: var(--text-primary, var(--text-color)); }
.mmv-icon-act {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0;
  border: none; border-radius: var(--radius-2xs, 3px);
  background: transparent; color: var(--text-muted, var(--text-tertiary)); cursor: pointer;
  transition: background var(--duration-fast, 0.1s), color var(--duration-fast, 0.1s);
}
.mmv-icon-act:hover { color: var(--text-primary, var(--text-color)); background: var(--bg-muted, var(--hover-bg)); }
/* 工具行（图标钮组）+ 模板行（独占全宽） */
.mmv-side-tools { display: flex; align-items: center; gap: 4px; padding: 0 12px 6px; }
.mmv-tool-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 24px; padding: 0; flex-shrink: 0;
  border: 1px solid var(--border, var(--border-color)); border-radius: var(--radius-xs, 4px);
  background: transparent; color: var(--text-secondary); cursor: pointer;
  transition: background var(--duration-fast, 0.1s), border-color var(--duration-fast, 0.1s), color var(--duration-fast, 0.1s);
}
.mmv-tool-btn:hover:not(:disabled) { border-color: var(--accent, var(--primary)); color: var(--accent, var(--primary)); }
.mmv-tool-btn:disabled { opacity: var(--disabled-opacity, 0.5); cursor: not-allowed; }
.mmv-side-template { padding: 0 12px 8px; }
.mmv-template-dd { width: 100%; }
.mmv-hidden-input { display: none; }
.mmv-doc-list { list-style: none; margin: 0; padding: 0 6px; overflow-y: auto; flex: 1; }
.mmv-doc-item {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 8px; margin-bottom: 2px; border-radius: var(--radius-xs, 4px);
  font-size: var(--font-size-xs); color: var(--text-secondary);
  cursor: pointer; transition: background var(--duration-fast, 0.1s), color var(--duration-fast, 0.1s);
}
.mmv-doc-item:hover { background: var(--bg-muted, var(--hover-bg)); }
.mmv-doc-item.active {
  background: var(--accent-soft, var(--primary-light));
  color: var(--accent, var(--primary)); font-weight: var(--font-weight-semibold);
}
.mmv-doc-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mmv-doc-actions { display: none; gap: 4px; }
.mmv-doc-item:hover .mmv-doc-actions { display: inline-flex; }
.mmv-doc-act { display: inline-flex; opacity: 0.6; cursor: pointer; }
.mmv-doc-act:hover { opacity: 1; }
.mmv-doc-act.danger:hover { color: var(--danger); }
.mmv-rename-input {
  width: 100%; padding: 2px 6px; font-size: var(--font-size-xs);
  border: 1px solid var(--accent, var(--primary)); border-radius: var(--radius-2xs, 3px);
  background: var(--bg-surface, var(--card-bg)); color: var(--text-primary, var(--text-color)); outline: none;
}
.mmv-side-foot {
  display: flex; align-items: center; gap: 4px;
  padding: 8px 12px; font-size: var(--text-micro-font-size, 10px);
  color: var(--text-muted, var(--text-tertiary));
  border-top: 1px solid var(--border, var(--border-color));
  min-height: 28px;
}

/* 主区画布 */
.mmv-main { flex: 1; position: relative; overflow: hidden; }
.mmv-map { width: 100%; height: 100%; }

/* 节点搜索浮框 */
.mmv-search { position: absolute; left: 16px; top: 16px; width: 240px; z-index: var(--z-dropdown, 100); }
.mmv-search-icon {
  position: absolute; left: 9px; top: 50%; transform: translateY(-50%);
  color: var(--text-muted, var(--text-tertiary)); pointer-events: none;
}
.mmv-search-input {
  width: 100%; padding: 5px 10px 5px 27px; font-size: var(--font-size-xs);
  border: 1px solid var(--border, var(--border-color)); border-radius: 999px;
  background: var(--bg-surface, var(--card-bg)); color: var(--text-primary, var(--text-color));
  outline: none; box-shadow: var(--shadow-sm, var(--shadow-md));
  transition: border-color var(--duration-fast, 0.1s), box-shadow var(--duration-fast, 0.1s);
}
.mmv-search-input:focus { border-color: var(--accent, var(--primary)); }
.mmv-search-results {
  list-style: none; margin: 4px 0 0; padding: 4px;
  background: var(--bg-surface, var(--card-bg));
  border: 1px solid var(--border, var(--border-color)); border-radius: var(--radius-mid, 8px);
  box-shadow: var(--shadow-md); max-height: 240px; overflow-y: auto;
}
.mmv-search-results li {
  display: flex; align-items: baseline; gap: 6px;
  padding: 4px 8px; border-radius: var(--radius-2xs, 3px); cursor: pointer;
}
.mmv-search-results li.is-hover { background: var(--accent-soft, var(--primary-light)); }
.mmv-search-topic {
  font-size: var(--font-size-xs); color: var(--text-primary, var(--text-color));
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mmv-search-parent { font-size: var(--text-micro-font-size, 10px); color: var(--text-muted, var(--text-tertiary)); flex-shrink: 0; }
.mmv-search-empty {
  margin-top: 4px; padding: 6px 10px; font-size: var(--font-size-xs);
  color: var(--text-muted, var(--text-tertiary));
  background: var(--bg-surface, var(--card-bg));
  border: 1px solid var(--border, var(--border-color)); border-radius: var(--radius-mid, 8px);
  box-shadow: var(--shadow-md);
}

/* mind-elixir 主题适配：映射到 WorldSea 设计令牌，自动跟随底色×强调色两轴 */
.mmv-map :deep(.map-container),
.mmv-map.map-container {
  --main-color: var(--text-primary, var(--text-color));
  --main-bgcolor: var(--bg-surface, var(--card-bg));
  --main-bgcolor-transparent: transparent;
  --main-border: 1px solid var(--border, var(--border-color));
  --color: var(--text-primary, var(--text-color));
  --bgcolor: var(--bg-surface, var(--card-bg));
  --selected: var(--accent-soft, var(--primary-light));
  --accent-color: var(--accent, var(--primary));
  --root-color: var(--on-accent, #fff);
  --root-bgcolor: var(--accent, var(--primary));
  --root-border-color: var(--accent, var(--primary));
  --panel-color: var(--text-secondary);
  --panel-bgcolor: var(--bg-surface, var(--card-bg));
  --panel-border-color: var(--border, var(--border-color));
  background: var(--bg-app, var(--bg));
}

/* 绑定面板（右下浮条） */
.mmv-bind-panel {
  position: absolute; right: 16px; bottom: 16px; width: 280px;
  background: var(--bg-surface, var(--card-bg));
  border: 1px solid var(--border, var(--border-color));
  border-radius: var(--radius-mid, 8px);
  box-shadow: var(--shadow-lg, var(--shadow-md));
  padding: 12px;
  z-index: var(--z-dropdown, 100);
}
.mmv-bind-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.mmv-bind-topic {
  flex: 1; font-weight: var(--font-weight-semibold); font-size: var(--font-size-sm);
  color: var(--text-primary, var(--text-color));
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mmv-bind-close {
  background: none; border: none; cursor: pointer; color: var(--text-muted, var(--text-tertiary));
  display: inline-flex; padding: 2px; border-radius: var(--radius-2xs, 3px);
}
.mmv-bind-close:hover { color: var(--text-primary, var(--text-color)); background: var(--bg-muted, var(--hover-bg)); }
.mmv-bind-row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.mmv-bind-label { font-size: var(--font-size-xs); color: var(--text-muted, var(--text-tertiary)); flex-shrink: 0; }
.mmv-bind-dd { flex: 1; }
.mmv-bind-linked { flex-wrap: wrap; }
.mmv-bind-entity { font-size: var(--font-size-xs); color: var(--text-secondary); flex: 1; }
.mmv-bind-btn {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px; font-size: var(--font-size-xs);
  border: 1px solid var(--border, var(--border-color)); border-radius: var(--radius-2xs, 3px);
  background: transparent; color: var(--text-secondary); cursor: pointer;
}
.mmv-bind-btn:hover { border-color: var(--accent, var(--primary)); color: var(--accent, var(--primary)); }
.mmv-bind-btn.primary { background: var(--accent, var(--primary)); border-color: var(--accent, var(--primary)); color: var(--on-accent, #fff); }
.mmv-bind-btn.primary:hover { filter: brightness(1.08); color: var(--on-accent, #fff); }
.mmv-bind-note-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.mmv-note-input {
  width: 100%; padding: 5px 8px; font-size: var(--font-size-xs); line-height: 1.5;
  font-family: inherit; resize: vertical; min-height: 40px;
  border: 1px solid var(--border, var(--border-color)); border-radius: var(--radius-2xs, 3px);
  background: var(--bg-surface, var(--card-bg)); color: var(--text-primary, var(--text-color));
  outline: none; transition: border-color var(--duration-fast, 0.1s);
}
.mmv-note-input:focus { border-color: var(--accent, var(--primary)); }

/* 备注悬浮预览（.mmv-main 局部定位；默认在节点上方，空间不足加 below 放下方） */
.mmv-note-tip {
  position: absolute;
  transform: translate(-50%, calc(-100% - 8px));
  max-width: 280px; padding: 6px 10px;
  font-size: var(--font-size-xs); line-height: 1.5;
  color: var(--text-primary, var(--text-color));
  background: var(--bg-surface, var(--card-bg));
  border: 1px solid var(--border, var(--border-color));
  border-radius: var(--radius-mid, 8px);
  box-shadow: var(--shadow-md);
  white-space: pre-wrap; word-break: break-word;
  pointer-events: none;
  z-index: calc(var(--z-dropdown, 100) + 1);
}
.mmv-note-tip.below { transform: translate(-50%, 8px); }

/* 自绘框选矩形（absolute 定位于画布容器，替代引擎 viselect 的 fixed 框） */
.mmv-map :deep(.mmv-selection-box) {
  display: none;
  position: absolute;
  z-index: 25;
  background: var(--accent-soft, var(--primary-light, rgba(79, 144, 242, 0.18)));
  border: 1px solid var(--accent, var(--primary));
  pointer-events: none;
}
.mmv-bind-hint { margin: 0; font-size: var(--text-micro-font-size, 10px); color: var(--text-muted, var(--text-tertiary)); line-height: 1.5; }
</style>
