<template>
  <div v-if="isDivider && dividerText === 'turn-separator'" class="turn-separator">
    <div class="turn-separator-line"></div>
  </div>
  <div v-else-if="isDivider" class="time-divider">
    <span class="time-divider-text">{{ dividerText }}</span>
  </div>
  <!-- 深度思考模式：区域布局 -->
  <div
    v-else-if="msg && hasVisibleContent && isDeepMode"
    class="deep-area"
    :class="deepSegmentType"
    :data-msg-id="msg.id"
    @mouseenter="emit('hover', msg.id)"
    @mouseleave="emit('leave')"
    @click="onMentionClick"
  >
    <!-- 深度模式：段标签 -->
    <div class="deep-segment-label" :class="deepSegmentType">
      <WsIcon :name="deepSegmentIcon" size="xs" />
      <span>{{ deepSegmentLabel }}</span>
    </div>

    <!-- 深度模式：推理过程 -->
    <div v-if="msg.thinking" class="deep-thinking">
      <div class="deep-thinking-header">
        <span class="deep-thinking-title">推理过程</span>
        <button class="deep-thinking-toggle" @click="thinkingOpen = thinkingOpen === null ? !isThinkingOpen : !thinkingOpen">
          {{ isThinkingOpen ? '收起' : '展开' }}
        </button>
      </div>
      <div v-show="isThinkingOpen" class="deep-thinking-content">{{ msg.thinking }}</div>
    </div>

    <!-- 深度模式：段分隔线（推理→工具） -->
    <div v-if="msg.thinking && msg.toolCalls?.length" class="deep-segment-divider"></div>

    <!-- 深度模式：阶段头 + 内联工具卡片 -->
    <div v-if="msg.toolCalls?.length" class="deep-phases">
      <template v-for="group in deepPhaseGroups" :key="group.label">
        <PhaseHeader
          :label="group.label"
          :index="group.index"
          :tools="group.tools"
          :is-active="group.isActive"
          :is-done="group.isDone"
          :default-expanded="group.isActive"
        />
        <div class="deep-phase-tools">
          <InlineToolCall v-for="tc in group.tools" :key="tc.id" :tc="tc" />
        </div>
      </template>
    </div>

    <!-- 深度模式：段分隔线（工具→输出 或 推理→输出） -->
    <div v-if="(msg.toolCalls?.length || msg.thinking) && msg.content" class="deep-segment-divider"></div>

    <!-- 深度模式：图片 -->
    <div v-if="msg.images?.length" class="deep-images">
      <img v-for="(img, idx) in msg.images" :key="idx" :src="`data:${img.mimeType};base64,${img.data}`" class="deep-img" />
    </div>

    <!-- 深度模式：文件 -->
    <div v-if="msg.files?.length" class="deep-files">
      <div v-for="(file, idx) in msg.files" :key="idx" class="deep-file-item">
        <span class="deep-file-icon"><WsIcon name="manuscript" size="xs" /></span>
        <span class="deep-file-name">{{ file.name }}</span>
      </div>
    </div>

    <!-- 深度模式：正文内容 -->
    <div class="deep-text" :style="agentFontStyle">
      <div class="deep-text-content" :class="{ 'text-collapsed': !textExpanded && isTextLong }">
        <div v-html="renderedMarkdown"></div>
      </div>
      <div v-if="isTextLong" class="text-expand-btn" @click="textExpanded = !textExpanded">
        {{ textExpanded ? '收起' : '展开全文' }}
      </div>
      <BlockTable v-for="block in tableBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
      <BlockChoice v-for="block in choiceBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
      <BlockCode v-for="block in codeBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
      <BlockEntityCard v-for="block in entityCardBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
      <BlockAlert v-for="block in alertBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
      <BlockStat v-for="block in statBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
      <BlockList v-for="block in listBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
      <BlockProgress v-for="block in progressBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
      <BlockComparison v-for="block in comparisonBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
      <BlockTimeline v-for="block in timelineBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
      <BlockImage v-for="block in imageBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
      <BlockVideo v-for="block in videoBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
      <BlockAccordion v-for="block in accordionBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
    </div>

    <!-- 深度模式：内联活动日志 -->
    <div v-if="deepActivityLogs.length > 0" class="deep-activity">
      <div class="deep-activity-header">
        <WsIcon name="clipboard-list" size="xs" />
        <span>活动记录</span>
        <span class="deep-activity-count">{{ deepActivityLogs.length }}</span>
      </div>
      <div class="deep-activity-list">
        <div v-for="log in deepActivityLogs" :key="log.id" class="deep-activity-item" :class="`log-${log.type}`">
          <span class="deep-activity-dot"></span>
          <span class="deep-activity-msg">{{ log.message }}</span>
          <span class="deep-activity-time">{{ formatActivityTime(log.timestamp) }}</span>
        </div>
      </div>
    </div>

    <!-- 深度模式：操作栏 -->
    <div class="deep-actions" :class="{ visible: isHovered }">
      <button class="action-btn" @click="emit('copy', msg)" title="复制"><WsIcon name="outline" size="xs" /></button>
      <button class="action-btn" @click="onExportImage" title="导出为图片"><WsIcon name="image" size="xs" /></button>
      <button class="action-btn" @click="onExportGif" title="导出为GIF"><WsIcon name="video" size="xs" /></button>
      <span class="msg-time">{{ formatTime(msg.timestamp) }}</span>
    </div>

    <BlockManuscript
      v-for="block in manuscriptBlocks"
      :key="block.id"
      :block="block"
      @action="emit('blockAction', $event)"
      @local-action="emit('manuscriptLocalAction', $event)"
    />
  </div>
  <!-- 普通模式：气泡布局 -->
  <div
    v-else-if="msg && hasVisibleContent"
    class="chat-msg"
    :class="[`msg-${msg.role}`, msg.role === 'assistant' ? `anim-${enterAnimation}` : '']"
    :data-msg-id="msg.id"
    @mouseenter="emit('hover', msg.id)"
    @mouseleave="emit('leave')"
    @click="onMentionClick"
  >
    <span class="msg-icon"><WsIcon :name="msg.role === 'user' ? 'character' : 'profile'" size="xs" /></span>
    <div class="msg-body" :style="msg.role === 'assistant' ? agentFontStyle : undefined">
      <div v-if="msg.thinking" class="msg-thinking" :class="{ 'thinking-deep': chatMode === 'deep' }">
        <details :open="isThinkingOpen" @toggle="(e: Event) => thinkingOpen = (e.target as HTMLDetailsElement).open">
          <summary><WsIcon name="manuscript" size="xs" /> {{ thinkingLabel }}</summary>
          <div class="thinking-content">{{ msg.thinking }}</div>
        </details>
      </div>
      <div v-if="msg.images?.length" class="msg-images">
        <img v-for="(img, idx) in msg.images" :key="idx" :src="`data:${img.mimeType};base64,${img.data}`" class="msg-img" />
      </div>
      <div v-if="msg.files?.length" class="msg-files">
        <div v-for="(file, idx) in msg.files" :key="idx" class="msg-file-item">
          <span class="msg-file-icon"><WsIcon name="manuscript" size="xs" /></span>
          <span class="msg-file-name">{{ file.name }}</span>
        </div>
      </div>
      <div v-if="msg.role === 'assistant'" class="msg-text">
        <div v-if="msg.toolCalls?.length" class="msg-tool-calls">
          <template v-if="chatMode === 'explore'">
            <SearchPath :tool-calls="msg.toolCalls" />
          </template>
          <template v-else>
            <template v-if="runningToolCalls.length > 0">
              <span v-for="tc in msg.toolCalls" :key="tc.id" class="tool-call-tag" :class="tc.status">
                <span v-if="tc.status === 'running'" class="tc-pulse">🔧</span>
                <span v-else-if="tc.status === 'completed'"><WsIcon name="check" size="xs" /></span>
                <span v-else><WsIcon name="x" size="xs" /></span>
                {{ getToolLabel(tc.name) }}
              </span>
            </template>
            <span v-else class="tool-call-summary">
              {{ completedCount }} 项调用已完成
            </span>
          </template>
        </div>
        <div class="msg-text-content" :class="{ 'text-collapsed': !textExpanded && isTextLong }">
          <div v-html="renderedMarkdown"></div>
        </div>
        <div v-if="isTextLong" class="text-expand-btn" @click="textExpanded = !textExpanded">
          {{ textExpanded ? '收起' : '展开全文' }}
        </div>
        <BlockTable v-for="block in tableBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
        <BlockChoice v-for="block in choiceBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
        <BlockCode v-for="block in codeBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
        <BlockEntityCard v-for="block in entityCardBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
        <BlockAlert v-for="block in alertBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
        <BlockStat v-for="block in statBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
        <BlockList v-for="block in listBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
        <BlockProgress v-for="block in progressBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
        <BlockComparison v-for="block in comparisonBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
        <BlockTimeline v-for="block in timelineBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
        <BlockImage v-for="block in imageBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
        <BlockVideo v-for="block in videoBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
        <BlockAccordion v-for="block in accordionBlocks" :key="block.id" :block="block" @action="emit('blockAction', $event)" />
      </div>
      <div v-else class="msg-text">
        <template v-for="(seg, i) in userContentSegments" :key="i">
          <span v-if="seg.type === 'chip'" class="kb-chip-inline"><WsIcon name="file" size="xs" />{{ seg.label }}</span>
          <span v-else>{{ seg.text }}</span>
        </template>
      </div>
      <div class="msg-actions" :class="{ visible: isHovered }">
        <button class="action-btn" @click="emit('copy', msg)" title="复制"><WsIcon name="outline" size="xs" /></button>
        <button v-if="msg.role === 'user'" class="action-btn" @click="emit('retry', msg)" title="重试"><WsIcon name="delete" size="xs" /></button>
        <button v-if="msg.role === 'assistant'" class="action-btn" @click="onExportImage" title="导出为图片"><WsIcon name="image" size="xs" /></button>
        <button v-if="msg.role === 'assistant'" class="action-btn" @click="onExportGif" title="导出为GIF"><WsIcon name="video" size="xs" /></button>
        <span class="msg-time">{{ formatTime(msg.timestamp) }}</span>
      </div>
    </div>
    <BlockManuscript
      v-for="block in manuscriptBlocks"
      :key="block.id"
      :block="block"
      @action="emit('blockAction', $event)"
      @local-action="emit('manuscriptLocalAction', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue'
import WsIcon from '../ui/WsIcon.vue'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import BlockTable from './blocks/BlockTable.vue'
import BlockChoice from './blocks/BlockChoice.vue'
import BlockCode from './blocks/BlockCode.vue'
import BlockEntityCard from './blocks/BlockEntityCard.vue'
import BlockAlert from './blocks/BlockAlert.vue'
import BlockStat from './blocks/BlockStat.vue'
import BlockList from './blocks/BlockList.vue'
import BlockProgress from './blocks/BlockProgress.vue'
import BlockComparison from './blocks/BlockComparison.vue'
import BlockTimeline from './blocks/BlockTimeline.vue'
import BlockImage from './blocks/BlockImage.vue'
import BlockVideo from './blocks/BlockVideo.vue'
import BlockAccordion from './blocks/BlockAccordion.vue'
import BlockManuscript from './blocks/BlockManuscript.vue'
import StepChain from './blocks/StepChain.vue'
import InlineToolCall from './blocks/InlineToolCall.vue'
import type { ToolCallView } from './blocks/InlineToolCall.vue'
import PhaseHeader from './blocks/PhaseHeader.vue'
import SearchPath from './blocks/SearchPath.vue'
import { usePersonaFont } from '../space/composables/usePersonaFont'
import { useActivityLog } from '../space/composables/useActivityLog'
import { replaceFontSpans } from '../composables/fontSpanParser'
import { useFontStore } from '../stores/fontStore'
import { renderText, toBlob, renderAnimatedText } from '@worldsmith/font-kit'
import { encodeGif } from '@worldsmith/motion-kit'
import { useStreamingRenderer } from '@worldsmith/perf-kit/render'
import { useEntityMentionIndex } from './composables/useEntityMentionIndex'
import { useEntityMiniPanel } from './composables/useEntityMiniPanel'
const { fontFamily, enterAnimation, profile } = usePersonaFont()
const { logs: activityLogs } = useActivityLog()
const fontStore = useFontStore()
const { matchInText } = useEntityMentionIndex()
const miniPanel = useEntityMiniPanel()
const agentFontFamily = computed(() => fontStore.prefs.agent.family || fontFamily.value || '')
const agentFontStyle = computed(() => {
  const style: Record<string, string> = {}
  if (agentFontFamily.value) style.fontFamily = agentFontFamily.value
  const pref = fontStore.prefs.agent
  if (pref.family && pref.weight !== 400) style.fontWeight = String(pref.weight)
  if (pref.family && pref.style !== 'normal') style.fontStyle = pref.style
  return style
})

const TOOL_LABELS: Record<string, string> = {
  entity_create: '创建实体',
  entity_get: '获取实体',
  entity_update: '更新实体',
  entity_delete: '删除实体',
  entity_list: '实体列表',
  relation_create: '创建关系',
  relation_delete: '删除关系',
  relation_list: '关系列表',
  daily_report: '每日报告',
  web_search: '联网搜索',
  output_table: '表格',
  output_choice: '选项',
  output_code: '代码',
  output_entity_card: '实体卡',
  output_alert: '提示',
  output_stat: '统计',
  output_list: '列表',
  output_progress: '进度',
  output_comparison: '对比',
  output_timeline: '时间线',
  output_image: '图片',
  output_accordion: '折叠区',
  output_manuscript: '文境',
  consistency_check: '一致性检查',
  content_search: '内容搜索',
  memory_store: '存储记忆',
  memory_recall: '回忆记忆',
  memory_delete: '删除记忆',
  project_export: '项目导出',
  project_import: '项目导入',
  load_skill: '加载技能',
  schema_validate: '模式验证',
  schema_register_entity_type: '注册实体类型',
  schema_unregister_entity_type: '注销实体类型',
  schema_get_entity_type: '获取实体类型',
  schema_list_entity_types: '列出实体类型',
  schema_update_entity_type: '更新实体类型',
  schema_register_validation: '注册验证规则',
  schema_register_view: '注册视图',
  schema_export: '导出模式',
  algo_graph_analysis: '图分析',
  algo_pagerank: 'PageRank',
  algo_community_detection: '社区检测',
  algo_force_layout: '力导向布局',
  algo_shortest_path: '最短路径',
  algo_k_shortest_paths: 'K最短路径',
  algo_topological_sort: '拓扑排序',
  algo_crdt_lww: 'CRDT-LWW',
  algo_crdt_orset: 'CRDT-ORSet',
  algo_crdt_rga: 'CRDT-RGA',
  algo_crdt_vector_clock: '向量时钟',
  algo_terrain_noise: '地形噪声',
  algo_terrain_heightmap: '地形高度图',
  algo_terrain_contour: '地形等高线',
  algo_hydraulic_erosion: '水力侵蚀',
  algo_viewshed: '视域分析',
  algo_constraint_solve: '约束求解',
  algo_dxf_parse: 'DXF解析',
  algo_dxf_generate: 'DXF生成',
  algo_dxf_extract_constraints: 'DXF提取约束',
  algo_polygon_boolean: '多边形布尔运算',
  algo_polygon_offset: '多边形偏移',
  algo_chaikin_smooth: 'Chaikin平滑',
  algo_find_shared_edges: '查找共享边',
  algo_find_line_polygon_intersections: '线面交点',
  algo_polygon_split: '多边形分割',
  algo_polygon_augment: '多边形增强',
  ui_create_surface: '创建界面',
  ui_update_components: '更新组件',
  ui_update_data: '更新数据',
  ui_delete_surface: '删除界面',
  plugin_write: '写入插件',
  file_write: '写入文件',
  file_list: '文件列表',
  file_read: '读取文件',
  file_analyze: '分析文件',
  fs_read: '读取文件',
  fs_write: '写入文件',
  fs_list: '文件列表',
  fs_move: '移动文件',
  fs_delete: '删除文件',
  fs_search: '搜索文件',
  pkg_install: '安装包',
  pkg_run: '运行包',
  pkg_info: '包信息',
  git_status: 'Git状态',
  git_log: 'Git日志',
  git_diff: 'Git差异',
  git_commit: 'Git提交',
  git_branch: 'Git分支',
  sys_info: '系统信息',
  sys_processes: '系统进程',
  sys_disk: '磁盘信息',
  web_search_cli: '联网搜索',
  web_fetch_cli: '网页抓取',
  web_qa_cli: '网页问答',
  web_dns_cli: 'DNS查询',
  web_ping_cli: 'Ping检测',
  web_fetch: '网页抓取',
  code_execute: '执行代码',
  notebook_create: '创建笔记本',
  notebook_update: '更新笔记本',
  notebook_link: '关联笔记本',
  notebook_create_note: '创建笔记',
  notebook_update_note: '更新笔记',
  notebook_list_notes: '笔记列表',
  notebook_execute_code: '执行代码',
  notebook_create_backlink: '创建反向链接',
  notebook_export_note: '导出笔记',
  execute_command: '执行命令',
  detect_terminal_mode: '检测终端模式',
  start_server: '启动服务',
  list_sub_agent_types: '列出子代理类型',
  dispatch_sub_agent: '调度子代理',
  get_sub_agent_status: '获取子代理状态',
  cancel_sub_agent: '取消子代理',
  a2ui_show_entity: '展示实体',
  a2ui_show_relation: '展示关系',
  module_builder_add_component: '添加模块组件',
  module_builder_remove_component: '移除模块组件',
  module_builder_update_config: '更新模块配置',
  module_builder_suggest_layout: '建议布局',
  retrofit_begin_session: '开始改造会话',
  retrofit_submit_intent: '提交意图',
  retrofit_confirm_and_stage: '确认并暂存',
  retrofit_apply_next: '应用下一步',
  retrofit_verify_and_accept: '验证并接受',
  retrofit_request_repair: '请求修复',
  retrofit_redirect: '重定向',
  retrofit_rollback_last: '回滚上一步',
  retrofit_abort: '中止改造',
  retrofit_session_phase: '改造阶段',
  retrofit_detect_conflicts: '检测冲突',
  retrofit_end_session: '结束改造会话',
  retrofit_patch_diff: '补丁差异',
  retrofit_patch_apply: '应用补丁',
  retrofit_apply: '应用改造',
  retrofit_undo: '撤销改造',
  workflow_list: '工作流列表',
  workflow_run: '运行工作流',
  workflow_status: '工作流状态',
  workflow_decision: '工作流决策',
  workflow_cancel: '取消工作流',
  workflow_create: '创建工作流',
  timeline_create_event: '创建时间线事件',
  timeline_update_event: '更新时间线事件',
  timeline_sort_events: '排序事件',
  timeline_detect_conflicts: '检测冲突',
  timeline_get_events: '获取事件',
  timeline_export_timeline: '导出时间线',
  graph_get_nodes: '获取节点',
  graph_get_edges: '获取边',
  graph_find_path: '查找路径',
  graph_cluster_analysis: '聚类分析',
  graph_highlight_nodes: '高亮节点',
  graph_export_snapshot: '导出快照',
  mindmap_create_node: '创建思维节点',
  mindmap_update_node: '更新思维节点',
  mindmap_delete_node: '删除思维节点',
  mindmap_get_structure: '获取结构',
  mindmap_auto_layout: '自动布局',
  mindmap_export_image: '导出图片',
  manuscript_create_chapter: '创建章节',
  manuscript_update_chapter: '更新章节',
  manuscript_list_chapters: '章节列表',
  manuscript_get_chapter_content: '获取章节内容',
  manuscript_insert_mention: '插入引用',
  manuscript_export_document: '导出文档',
  outline_create_node: '创建大纲节点',
  outline_update_node: '更新大纲节点',
  outline_move_node: '移动大纲节点',
  outline_get_structure: '获取大纲结构',
  outline_link_entity: '关联实体',
  outline_export_outline: '导出大纲',
  tactical_deploy_unit: '部署单位',
  tactical_move_unit: '移动单位',
  tactical_get_battle_state: '获取战斗状态',
  tactical_simulate_turn: '模拟回合',
  tactical_export_battle_log: '导出战斗日志',
  magic_create_skill_node: '创建技能节点',
  magic_update_skill_node: '更新技能节点',
  magic_get_skill_tree: '获取技能树',
  magic_validate_tree: '验证技能树',
  magic_export_skill_tree: '导出技能树',
  plan_create: '创建计划',
  plan_update: '更新计划',
  image_generate: '图片生成',
  image_edit: '图片编辑',
  video_generate: '视频生成',
  kb_write: '知识写入',
  kb_read: '知识读取',
  kb_search: '知识搜索',
  kb_delete: '知识删除',
  persona_apply: '人格附体',
  persona_reset: '人格重置',
  persona_update: '人格更新',
}

const SNAKE_TRANSLATIONS: Record<string, string> = {
  create: '创建', get: '获取', update: '更新', delete: '删除', remove: '移除',
  list: '列表', search: '搜索', find: '查找', add: '添加', move: '移动',
  export: '导出', import: '导入', run: '运行', execute: '执行', start: '启动',
  stop: '停止', cancel: '取消', validate: '验证', check: '检查', detect: '检测',
  analyze: '分析', parse: '解析', generate: '生成', extract: '提取', install: '安装',
  write: '写入', read: '读取', status: '状态', info: '信息', log: '日志',
  diff: '差异', commit: '提交', branch: '分支', deploy: '部署', simulate: '模拟',
  register: '注册', unregister: '注销', show: '展示', link: '关联',
  suggest: '建议', confirm: '确认', apply: '应用', verify: '验证',
  request: '请求', repair: '修复', redirect: '重定向', rollback: '回滚',
  abort: '中止', end: '结束', undo: '撤销', sort: '排序', highlight: '高亮',
  insert: '插入', auto: '自动', layout: '布局', stage: '暂存',
  file: '文件', entity: '实体', relation: '关系', schema: '模式',
  memory: '记忆', project: '项目', skill: '技能', content: '内容',
  daily: '每日', report: '报告', web: '网页', code: '代码',
  notebook: '笔记本', note: '笔记', command: '命令', terminal: '终端',
  server: '服务', agent: '代理', module: '模块', component: '组件',
  config: '配置', surface: '界面', plugin: '插件', package: '包',
  system: '系统', process: '进程', disk: '磁盘', workflow: '工作流',
  decision: '决策', timeline: '时间线', event: '事件', graph: '图',
  node: '节点', edge: '边', path: '路径', cluster: '聚类',
  snapshot: '快照', mindmap: '思维导图', structure: '结构',
  image: '图片', manuscript: '文稿', chapter: '章节', document: '文档',
  outline: '大纲', tactical: '战术', unit: '单位', battle: '战斗',
  turn: '回合', magic: '魔法', tree: '树', constraint: '约束',
  polygon: '多边形', boolean: '布尔', offset: '偏移', smooth: '平滑',
  shared: '共享', intersection: '交点', split: '分割', augment: '增强',
  terrain: '地形', noise: '噪声', heightmap: '高度图', contour: '等高线',
  hydraulic: '水力', erosion: '侵蚀', viewshed: '视域',
  patch: '补丁', conflict: '冲突', session: '会话', phase: '阶段',
  intent: '意图', backlink: '反向链接', mention: '引用',
  mode: '模式', type: '类型', view: '视图', data: '数据',
  cli: '命令行', dns: 'DNS', ping: 'Ping', qa: '问答', fetch: '抓取',
}

function getToolLabel(name: string): string {
  if (TOOL_LABELS[name]) return TOOL_LABELS[name]
  const parts = name.split('_')
  const translated = parts.map(p => SNAKE_TRANSLATIONS[p] || p).join('')
  return translated !== name ? translated : name.replace(/_/g, ' ')
}

const props = withDefaults(defineProps<{
  isDivider?: boolean
  dividerText?: string
  msg?: {
    id: string
    role: 'user' | 'assistant'
    content: string
    thinking?: string
    images?: { mimeType: string; data: string }[]
    files?: { name: string; content: string }[]
    blocks?: import('@agent/index').MessageBlock[]
    toolCalls?: { id: string; name: string; args: Record<string, unknown>; status: 'running' | 'completed' | 'failed'; result?: string; startedAt: number; endedAt?: number }[]
    timestamp: number
    metadata?: Record<string, unknown>
  }
  isHovered: boolean
  chatMode?: 'normal' | 'deep' | 'explore' | 'task' | 'group-chat'
  useDeepLayout?: boolean
}>(), {
  useDeepLayout: true,
})

const emit = defineEmits<{
  (e: 'hover', msgId: string): void
  (e: 'leave'): void
  (e: 'copy', msg: any): void
  (e: 'retry', msg: any): void
  (e: 'blockAction', event: { blockId: string; action: string; data?: Record<string, unknown> }): void
  (e: 'manuscriptLocalAction', event: { blockId: string; action: string; data?: Record<string, unknown> }): void
}>()

const marked = new Marked({ gfm: true, breaks: true })

// 流式输出时 content 高频变化，用 rAF 节流渲染
const rawMarkdown = computed(() => {
  if (!props.msg || props.msg.role !== 'assistant' || !props.msg.content) return ''
  const withFontSpans = replaceFontSpans(props.msg.content.trim())
  if (!withFontSpans) return ''
  return stripJsonBlocks(withFontSpans)
})

const throttledRaw = useStreamingRenderer(() => rawMarkdown.value, { initialValue: '' })

const renderedMarkdown = computed(() => {
  const filtered = throttledRaw.value
  return filtered ? renderMd(filtered) : ''
})

function stripJsonBlocks(text: string): string {
  const mdParts: string[] = []
  let lastEnd = 0
  let i = 0
  while (i < text.length) {
    if (text[i] === '{') {
      const jsonStr = tryExtractJson(text, i)
      if (jsonStr) {
        if (i > lastEnd) mdParts.push(text.slice(lastEnd, i))
        lastEnd = i + jsonStr.length
        i = lastEnd
        continue
      }
    }
    i++
  }
  if (lastEnd < text.length) mdParts.push(text.slice(lastEnd))
  return mdParts.map(s => s.trim()).filter(Boolean).join('\n')
}

function tryExtractJson(text: string, start: number): string | null {
  if (text[start] !== '{') return null
  let depth = 0
  let j = start
  let inStr = false
  let esc = false
  while (j < text.length) {
    const ch = text[j]
    if (esc) { esc = false; j++; continue }
    if (ch === '\\' && inStr) { esc = true; j++; continue }
    if (ch === '"') { inStr = !inStr; j++; continue }
    if (!inStr) {
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          const str = text.slice(start, j + 1)
          try {
            const obj = JSON.parse(str)
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) return str
          } catch {}
          return null
        }
      }
    }
    j++
  }
  return null
}

const hasVisibleContent = computed(() => {
  if (!props.msg) return false
  if (props.msg.role === 'user') return true
  if (props.msg.thinking) return true
  if (props.msg.images?.length) return true
  if (props.msg.files?.length) return true
  if (props.msg.blocks?.length) return true
  if (props.msg.toolCalls?.length) return true
  if (props.msg.content) {
    const text = props.msg.content.trim()
    if (!text) return false
    if (text.startsWith('{')) return false
    return true
  }
  return false
})

const runningToolCalls = computed(() =>
  props.msg?.toolCalls?.filter(tc => tc.status === 'running') ?? []
)

const completedCount = computed(() =>
  props.msg?.toolCalls?.filter(tc => tc.status === 'completed').length ?? 0
)

/** 解析用户消息中的 @path 引用为 chip + 文本片段 */
const userContentSegments = computed(() => {
  const content = props.msg?.content || ''
  if (!content) return []
  const segments: Array<{ type: 'text'; text: string } | { type: 'chip'; label: string }> = []
  // 匹配 @project/xxx 或 @xxx/yyy.md 格式的知识引用
  const pattern = /@([\w/.-]+\.md|[\w/.-]+\/[\w/.-]+\.\w+)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: content.slice(lastIndex, match.index) })
    }
    const fullPath = match[1]
    const label = fullPath.split('/').pop() || fullPath
    segments.push({ type: 'chip', label })
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'text', text: content.slice(lastIndex) })
  }
  return segments
})

const isTextLong = computed(() => {
  if (!props.msg?.content) return false
  const lines = props.msg.content.split('\n').length
  const charLen = props.msg.content.length
  return lines > 8 || charLen > 600
})

const textExpanded = ref(false)

const blocks = computed(() => props.msg?.blocks || [])
const chatMode = computed(() => props.chatMode || (props.msg?.metadata?.chatMode as string) || 'normal')
const isDeepMode = computed(() => chatMode.value === 'deep' && props.useDeepLayout)

/** 深度模式阶段定义：工具名→阶段映射 */
const DEEP_PHASES = [
  { label: '问题拆解', tools: ['output_list', 'output_choice'] },
  { label: '证据收集', tools: [
    'entity_get', 'entity_list', 'entity_suggest_field', 'entity_smart_fill', 'entity_get_context',
    'content_search', 'relation_list',
    'kb_search', 'kb_list', 'kb_read', 'kb_extract', 'kb_reflect', 'kb_link',
    'web_search', 'web_fetch', 'web_search_cli', 'web_fetch_cli', 'web_qa_cli',
    'vision_analyze', 'list_vision_images',
    'memory_recall',
    'fs_read', 'fs_list', 'fs_search', 'fs_stat',
    'read_file', 'search_files', 'list_directory',
    'file_read', 'file_list', 'file_analyze',
  ] },
  { label: '推理分析', tools: [
    'algo_graph_analysis', 'algo_pagerank', 'algo_community_detection',
    'algo_shortest_path', 'algo_k_shortest_paths', 'algo_topological_sort',
    'algo_force_layout',
    'consistency_check', 'schema_validate',
    'graph_get_nodes', 'graph_get_edges', 'graph_find_path', 'graph_cluster_analysis',
    'graph_highlight_nodes', 'graph_export_snapshot', 'graph_filter_by_type', 'graph_search_subgraph',
  ] },
  { label: '创作操作', tools: [
    'entity_create', 'entity_update', 'entity_delete',
    'relation_create', 'relation_delete',
    'kb_write', 'kb_delete', 'kb_init',
    'memory_store', 'memory_delete',
    'image_generate', 'image_edit', 'image_gen_config', 'image_list', 'image_show',
    'video_generate', 'video_status', 'video_list', 'video_show', 'video_gen_config',
    'persona_apply', 'persona_reset', 'persona_update',
    'load_skill',
    'schema_register_entity_type', 'schema_unregister_entity_type',
    'schema_get_entity_type', 'schema_list_entity_types', 'schema_update_entity_type',
    'schema_register_validation', 'schema_register_view', 'schema_export',
    'ui_create_surface', 'ui_update_components', 'ui_update_data', 'ui_delete_surface',
    'a2ui_show_entity', 'a2ui_show_relation',
    'fs_write', 'fs_move', 'fs_delete', 'fs_mkdir', 'fs_copy',
    'write_file', 'edit_file',
    'file_write', 'file_delete', 'file_associate',
    'plugin_write',
    'project_export', 'project_import',
    'daily_report',
    'plan_create', 'plan_update',
  ] },
  { label: '结论输出', tools: [
    'output_table', 'output_comparison', 'output_accordion', 'output_alert',
    'output_stat', 'output_code', 'output_entity_card', 'output_progress',
    'output_timeline', 'output_image', 'output_manuscript',
  ] },
]

const ALL_PHASE_TOOLS = new Set(DEEP_PHASES.flatMap(p => p.tools))

/** 深度模式：将工具调用按阶段分组，返回阶段列表（含阶段头+工具卡片） */
interface PhaseGroup {
  label: string
  index: number
  tools: ToolCallView[]
  isActive: boolean
  isDone: boolean
}

const deepPhaseGroups = computed<PhaseGroup[]>(() => {
  if (!isDeepMode.value || !props.msg?.toolCalls?.length) return []
  const toolCalls = props.msg.toolCalls as ToolCallView[]

  // 将每个工具分配到阶段
  const phaseToolMap = DEEP_PHASES.map(phase =>
    toolCalls.filter(tc => phase.tools.includes(tc.name))
  )
  // 兜底：未匹配的工具归入"其他操作"
  const unmatched = toolCalls.filter(tc => !ALL_PHASE_TOOLS.has(tc.name))

  const groups: PhaseGroup[] = []
  let activeFound = false

  DEEP_PHASES.forEach((phase, idx) => {
    const tools = phaseToolMap[idx]
    if (tools.length === 0) return // 跳过空阶段
    const hasRunning = tools.some(tc => tc.status === 'running')
    const allDone = tools.every(tc => tc.status === 'completed' || tc.status === 'failed')
    const isActive = !activeFound && (hasRunning || !allDone)
    if (isActive) activeFound = true
    groups.push({
      label: phase.label,
      index: groups.length,
      tools,
      isActive,
      isDone: allDone,
    })
  })

  // 兜底阶段
  if (unmatched.length > 0) {
    const hasRunning = unmatched.some(tc => tc.status === 'running')
    const allDone = unmatched.every(tc => tc.status === 'completed' || tc.status === 'failed')
    const isActive = !activeFound && (hasRunning || !allDone)
    groups.push({
      label: '其他操作',
      index: groups.length,
      tools: unmatched,
      isActive,
      isDone: allDone,
    })
  }

  return groups
})

/** 深度模式：判断当前消息的段类型（推理/工具/输出） */
const deepSegmentType = computed(() => {
  if (!props.msg) return 'output'
  if (props.msg.thinking && !props.msg.content && !props.msg.toolCalls?.length) return 'thinking'
  if (props.msg.toolCalls?.length && !props.msg.content) return 'tooling'
  return 'output'
})

const deepSegmentLabel = computed(() => {
  switch (deepSegmentType.value) {
    case 'thinking': return '推理过程'
    case 'tooling': return '调用工具'
    case 'output': return '输出'
    default: return '输出'
  }
})

const deepSegmentIcon = computed(() => {
  switch (deepSegmentType.value) {
    case 'thinking': return 'manuscript'
    case 'tooling': return 'wrench'
    case 'output': return 'file'
    default: return 'file'
  }
})
const thinkingLabel = computed(() => chatMode.value === 'explore' ? '搜索思路' : '推理链')
const thinkingDefaultOpen = computed(() => chatMode.value === 'deep')
const thinkingOpen = ref<boolean | null>(null)
const isThinkingOpen = computed(() => {
  if (thinkingOpen.value !== null) return thinkingOpen.value
  return thinkingDefaultOpen.value
})
const tableBlocks = computed(() => blocks.value.filter(b => b.type === 'table'))
const choiceBlocks = computed(() => blocks.value.filter(b => b.type === 'choice'))
const codeBlocks = computed(() => blocks.value.filter(b => b.type === 'code'))
const entityCardBlocks = computed(() => blocks.value.filter(b => b.type === 'entity-card'))
const alertBlocks = computed(() => blocks.value.filter(b => b.type === 'alert'))
const statBlocks = computed(() => blocks.value.filter(b => b.type === 'stat'))
const listBlocks = computed(() => blocks.value.filter(b => b.type === 'list'))
const progressBlocks = computed(() => blocks.value.filter(b => b.type === 'progress'))
const comparisonBlocks = computed(() => blocks.value.filter(b => b.type === 'comparison'))
const timelineBlocks = computed(() => blocks.value.filter(b => b.type === 'timeline'))
const imageBlocks = computed(() => blocks.value.filter(b => b.type === 'image'))
const videoBlocks = computed(() => blocks.value.filter(b => b.type === 'video'))
const accordionBlocks = computed(() => blocks.value.filter(b => b.type === 'accordion'))
const manuscriptBlocks = computed(() => blocks.value.filter(b => b.type === 'manuscript'))

/** 深度模式：与当前消息时间窗口相关的活动日志（消息前后30秒内） */
const deepActivityLogs = computed(() => {
  if (!isDeepMode.value || !props.msg) return []
  const msgTime = props.msg.timestamp
  const window = 120_000 // 2分钟窗口
  return activityLogs.value.filter(log =>
    log.timestamp >= msgTime - 5_000 && log.timestamp <= msgTime + window
  )
})

let purifyHookRegistered = false
if (!purifyHookRegistered) {
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName?.startsWith('data-ws-')) {
      data.forceKeepAttr = true
    }
  })
  purifyHookRegistered = true
}

/**
 * 实体名高亮注入缓存：按原始文本缓存注入结果，避免流式输出时重复匹配
 * WeakMap 允许 GC 回收已销毁消息的文本
 */
const mentionInjectCache = new WeakMap<string, string>()

/**
 * 在 marked 渲染后的 HTML 中注入实体名高亮
 * 策略：用 DOMParser 解析 HTML，遍历纯文本节点（跳过 code/pre/a 等已格式化元素），
 * 匹配实体名并包裹 <span data-ws-entity-id="..." class="ws-entity-mention">
 */
function injectMentions(html: string): string {
  if (!html) return ''
  // 缓存命中：避免流式输出时同一段文本反复匹配
  const cached = mentionInjectCache.get(html)
  if (cached !== undefined) return cached

  try {
    const doc = new DOMParser().parseFromString(`<div id="__root">${html}</div>`, 'text/html')
    const root = doc.getElementById('__root')
    if (!root) return html

    let hasMatch = false
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        // 跳过 code/pre/a 标签内的文本（这些不需要实体高亮）
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        const tag = parent.tagName.toLowerCase()
        if (tag === 'code' || tag === 'pre' || tag === 'a' || tag === 'script' || tag === 'style') {
          return NodeFilter.FILTER_REJECT
        }
        // 跳过已是 mention span 内的文本
        if (parent.classList?.contains('ws-entity-mention')) {
          return NodeFilter.FILTER_REJECT
        }
        return node.nodeValue && node.nodeValue.trim().length >= 2
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT
      },
    })

    const textNodes: Text[] = []
    let current: Node | null
    while ((current = walker.nextNode())) {
      textNodes.push(current as Text)
    }

    for (const textNode of textNodes) {
      const text = textNode.nodeValue || ''
      const matches = matchInText(text)
      if (matches.length === 0) continue

      // 将文本节点替换为：普通文本 + mention span 的混合序列
      const fragment = doc.createDocumentFragment()
      let lastEnd = 0
      for (const m of matches) {
        if (m.start > lastEnd) {
          fragment.appendChild(doc.createTextNode(text.slice(lastEnd, m.start)))
        }
        const span = doc.createElement('span')
        span.className = 'ws-entity-mention'
        span.setAttribute('data-ws-entity-id', m.entityIds[0])
        span.setAttribute('data-ws-entity-type', m.entityType)
        span.setAttribute('data-ws-entity-name', m.name)
        span.textContent = m.name
        span.title = `${m.entityType}: ${m.name}（点击查看详情）`
        fragment.appendChild(span)
        lastEnd = m.end
      }
      if (lastEnd < text.length) {
        fragment.appendChild(doc.createTextNode(text.slice(lastEnd)))
      }
      textNode.parentNode?.replaceChild(fragment, textNode)
      hasMatch = true
    }

    const result = hasMatch ? root.innerHTML : html
    mentionInjectCache.set(html, result)
    return result
  } catch {
    // DOMParser 不可用或解析失败时降级为原始 HTML
    return html
  }
}

function renderMd(text: string): string {
  if (!text) return ''
  const raw = DOMPurify.sanitize(marked.parse(text) as string)
  return injectMentions(raw)
}

/**
 * 事件委托：点击消息内实体名 mention 时打开实体小窗浮窗
 * 通过 closest('.ws-entity-mention') 判断点击目标是否为 mention
 */
function onMentionClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target) return
  const mention = target.closest('.ws-entity-mention') as HTMLElement | null
  if (!mention) return

  const entityId = mention.getAttribute('data-ws-entity-id')
  const entityType = mention.getAttribute('data-ws-entity-type') || ''
  const name = mention.getAttribute('data-ws-entity-name') || ''
  if (!entityId) return

  const triggerRect = mention.getBoundingClientRect()
  miniPanel.open(entityId, triggerRect, { entityType, name })
  e.stopPropagation()
}

/** 扫描 [data-ws-font] 元素并应用内联字体样式 */
function applyFontSpanStyles() {
  if (!props.msg?.id) return
  const el = document.querySelector(`[data-msg-id="${props.msg.id}"]`)
  if (!el) return
  const fontSpans = el.querySelectorAll('[data-ws-font]')
  for (const span of fontSpans) {
    const family = span.getAttribute('data-ws-font')
    const weight = span.getAttribute('data-ws-weight')
    const style = span.getAttribute('data-ws-style')
    if (family) {
      const htmlEl = span as HTMLElement
      htmlEl.style.fontFamily = `"${family}", sans-serif`
      if (weight && weight !== '400') htmlEl.style.fontWeight = weight
      if (style && style !== 'normal') htmlEl.style.fontStyle = style
    }
  }
}

watch(renderedMarkdown, () => {
  nextTick(applyFontSpanStyles)
})

function formatTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function formatActivityTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}

async function onExportImage() {
  if (!props.msg?.content) return
  try {
    const text = stripJsonBlocks(props.msg.content.trim())
    const plainText = text.replace(/<[^>]*>/g, '').trim()
    if (!plainText) return

    const { canvas } = renderText({
      text: plainText.slice(0, 500),
      fontFamily: profile.value.fontFamily,
      fontSize: 16 * profile.value.sizeScale,
      fontWeight: profile.value.weightDefault,
      color: '#e0e0e0',
      backgroundColor: '#1a1a2e',
      maxWidth: 480,
      padding: 20,
    })

    const blob = await toBlob(canvas, 'png')
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `agent-msg-${Date.now()}.png`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('导出图片失败:', err)
  }
}

async function onExportGif() {
  if (!props.msg?.content) return
  try {
    const text = stripJsonBlocks(props.msg.content.trim())
    const plainText = text.replace(/<[^>]*>/g, '').trim()
    if (!plainText) return

    const result = renderAnimatedText({
      text: plainText.slice(0, 200),
      effect: enterAnimation.value,
      renderOptions: {
        fontFamily: profile.value.fontFamily,
        fontSize: 16 * profile.value.sizeScale,
        fontWeight: profile.value.weightDefault,
        color: '#e0e0e0',
        backgroundColor: '#1a1a2e',
        maxWidth: 480,
        padding: 20,
      },
      duration: 2000,
      fps: 15,
    })

    const gifFrames = result.frames.map(frame => ({
      width: frame.width,
      height: frame.height,
      data: frame.imageData.data,
      delay: frame.delay,
    }))

    const gifData = encodeGif({ width: result.width, height: result.height, frames: gifFrames, loop: 0 })
    const gifBlob = new Blob([Uint8Array.from(gifData)], { type: 'image/gif' })
    const url = URL.createObjectURL(gifBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `agent-anim-${Date.now()}.gif`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('导出GIF失败:', err)
  }
}
</script>

<style scoped>
/* ===== 轮次分隔线 ===== */
.turn-separator {
  padding: 8px 20px;
  display: flex;
  align-items: center;
}

.turn-separator-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--agent-primary) 25%, transparent) 20%,
    color-mix(in srgb, var(--agent-primary) 25%, transparent) 80%,
    transparent
  );
}

/* ===== 深度思考模式：区域布局 ===== */
.deep-area {
  width: 100%;
  max-width: 100%;
  padding: 16px 20px;
  border-left: 3px solid var(--agent-primary);
  background: color-mix(in srgb, var(--agent-primary) 3%, transparent);
  border-radius: 0 12px 12px 0;
  animation: deep-area-in 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 深度模式：段标签 */
.deep-segment-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  width: fit-content;
}

.deep-segment-label.thinking {
  color: var(--agent-segment-thinking);
  background: color-mix(in srgb, var(--agent-segment-thinking) 10%, transparent);
}

.deep-segment-label.tooling {
  color: var(--agent-segment-tooling);
  background: color-mix(in srgb, var(--agent-segment-tooling) 10%, transparent);
}

.deep-segment-label.output {
  color: var(--agent-segment-output);
  background: color-mix(in srgb, var(--agent-segment-output) 10%, transparent);
}

/* 段类型边框色 */
.deep-area.thinking {
  border-left-color: var(--agent-segment-thinking);
  background: color-mix(in srgb, var(--agent-segment-thinking) 3%, transparent);
}

.deep-area.tooling {
  border-left-color: var(--agent-segment-tooling);
  background: color-mix(in srgb, var(--agent-segment-tooling) 3%, transparent);
}

.deep-area.output {
  border-left-color: var(--agent-segment-output);
  background: color-mix(in srgb, var(--agent-segment-output) 3%, transparent);
}

/* 深度模式：段内分隔线 */
.deep-segment-divider {
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    var(--agent-hover-bg) 10%,
    var(--agent-hover-bg) 90%,
    transparent
  );
  margin: 2px 0;
}

@keyframes deep-area-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 深度模式：推理过程 */
.deep-thinking {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--agent-primary) 15%, transparent);
  background: color-mix(in srgb, var(--agent-primary) 4%, transparent);
}

.deep-thinking-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--agent-primary) 6%, transparent);
  color: var(--agent-primary);
  font-size: 13px;
  font-weight: 600;
}

.deep-thinking-title {
  flex: 1;
}

.deep-thinking-toggle {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--agent-primary) 20%, transparent);
  background: color-mix(in srgb, var(--agent-primary) 8%, transparent);
  color: var(--agent-primary);
  cursor: pointer;
  transition: background 0.15s;
}

.deep-thinking-toggle:hover {
  background: color-mix(in srgb, var(--agent-primary) 15%, transparent);
}

.deep-thinking-content {
  padding: 10px 14px;
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
  max-height: 400px;
  overflow-y: auto;
  word-break: break-word;
}

/* 深度模式：阶段+内联工具卡片 */
.deep-phases {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.deep-phase-tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 12px;
  border-left: 2px solid var(--agent-hover-bg);
  margin-left: 10px;
}

/* 深度模式：图片 */
.deep-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.deep-img {
  max-width: 280px;
  max-height: 200px;
  border-radius: 8px;
  object-fit: contain;
  cursor: pointer;
  transition: transform 0.15s;
}

.deep-img:hover {
  transform: scale(1.03);
}

/* 深度模式：文件 */
.deep-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.deep-file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--agent-hover-bg);
  border: 1px solid var(--agent-hover-bg);
  border-radius: 8px;
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
}

.deep-file-icon { font-size: var(--font-size-sm); }

.deep-file-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 深度模式：正文 */
.deep-text {
  font-size: var(--font-size-base);
  line-height: 1.7;
  color: var(--agent-text);
  word-break: break-word;
  font-family: var(--agent-font);
}

.deep-text-content {
  position: relative;
}

.deep-text-content.text-collapsed {
  max-height: 200px;
  overflow: hidden;
}

.deep-text-content.text-collapsed::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 56px;
  background: linear-gradient(transparent, color-mix(in srgb, var(--agent-primary) 3%, transparent));
  pointer-events: none;
}

.deep-text :deep(h1), .deep-text :deep(h2), .deep-text :deep(h3) {
  margin: 12px 0 6px;
  font-weight: var(--font-weight-semibold);
}

.deep-text :deep(h1) { font-size: var(--font-size-xl) }
.deep-text :deep(h2) { font-size: var(--font-size-lg) }
.deep-text :deep(h3) { font-size: var(--font-size-md) }
.deep-text :deep(p) { margin: 6px 0 }
.deep-text :deep(ul), .deep-text :deep(ol) { margin: 6px 0; padding-left: 22px }
.deep-text :deep(li) { margin: 3px 0 }
.deep-text :deep(code) {
  background: var(--agent-hover-bg);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: var(--font-size-sm);
  font-family: 'Consolas', 'Monaco', monospace;
}

.deep-text :deep(pre) {
  background: color-mix(in srgb, var(--agent-bg) 20%, transparent);
  padding: 12px 14px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 10px 0;
}
.deep-text :deep(pre code) { background: none; padding: 0; font-size: var(--font-size-sm); line-height: 1.5 }
.deep-text :deep(blockquote) {
  border-left: 3px solid var(--agent-primary);
  margin: 8px 0; padding: 6px 14px; opacity: 0.85;
}
.deep-text :deep(table) { border-collapse: collapse; margin: 10px 0; font-size: var(--font-size-sm) }
.deep-text :deep(th), .deep-text :deep(td) {
  border: 1px solid var(--agent-border-color); padding: 6px 10px;
}
.deep-text :deep(a) { color: var(--agent-primary); text-decoration: underline }
.deep-text :deep(hr) { border: none; border-top: 1px solid var(--agent-border-color); margin: 10px 0 }

/* 深度模式：内联活动日志 */
.deep-activity {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--agent-hover-bg);
  background: var(--agent-hover-bg);
}

.deep-activity-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--agent-text-secondary);
  border-bottom: 1px solid var(--agent-hover-bg);
}

.deep-activity-count {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--agent-primary) 10%, transparent);
  color: var(--agent-primary);
  margin-left: auto;
}

.deep-activity-list {
  padding: 4px 0;
  max-height: 160px;
  overflow-y: auto;
}

.deep-activity-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  font-size: 11px;
  transition: background 0.1s;
}

.deep-activity-item:hover {
  background: var(--agent-hover-bg);
}

.deep-activity-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--agent-text-tertiary);
}

.deep-activity-item.log-tool .deep-activity-dot { background: var(--agent-primary); }
.deep-activity-item.log-knowledge .deep-activity-dot { background: var(--agent-success); }
.deep-activity-item.log-memory .deep-activity-dot { background: var(--agent-warning); }
.deep-activity-item.log-error .deep-activity-dot { background: var(--agent-danger); }

.deep-activity-msg {
  flex: 1;
  color: var(--agent-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.deep-activity-time {
  font-size: 10px;
  color: var(--agent-text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* 深度模式：操作栏 */
.deep-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
  height: 20px;
}

.deep-actions.visible { opacity: 1 }

/* ===== 普通模式：气泡布局 ===== */
.chat-msg {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 85%;
  animation: ws-msg-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.msg-user { margin-left: auto; flex-direction: row-reverse }

.msg-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-sm);
  border-radius: 50%;
  background: var(--agent-hover-bg);
}

.msg-assistant .msg-icon {
  box-shadow: 0 0 6px color-mix(in srgb, var(--agent-primary) 30%, transparent);
}

.msg-user .msg-icon {
  border-radius: 6px;
}

.msg-body {
  font-size: var(--font-size-base);
  line-height: 1.6;
  color: var(--agent-text);
  word-break: break-word;
  position: relative;
  font-family: var(--agent-font);
  background: transparent;
}

.msg-user .msg-body { text-align: right }

.msg-thinking { margin-bottom: 6px }
.msg-thinking summary {
  cursor: pointer; font-size: var(--font-size-sm);
  color: var(--agent-text-secondary); padding: 2px 0;
}
.thinking-content {
  font-size: var(--font-size-sm);
  color: var(--agent-text-tertiary);
  line-height: 1.5; max-height: 200px; overflow-y: auto;
  padding: 6px 8px;
  background: var(--agent-hover-bg);
  border-radius: 6px; margin-top: 4px; white-space: pre-wrap;
}
.msg-thinking.thinking-deep {
  border-left: 3px solid var(--agent-primary);
  padding-left: 8px;
  margin-bottom: 8px;
}
.msg-thinking.thinking-deep .thinking-content {
  background: color-mix(in srgb, var(--agent-primary) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--agent-primary) 10%, transparent);
  max-height: 400px;
}
.msg-thinking.thinking-deep summary {
  color: var(--agent-primary);
  font-weight: 600;
}

.msg-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.msg-files {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}

.msg-file-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: var(--agent-hover-bg);
  border: 1px solid var(--agent-hover-bg);
  border-radius: 6px;
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
}

.msg-file-icon {
  font-size: var(--font-size-sm);
}

.msg-file-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.msg-img {
  max-width: 200px;
  max-height: 160px;
  border-radius: 8px;
  object-fit: contain;
  cursor: pointer;
  transition: transform 0.15s;
}

.msg-img:hover {
  transform: scale(1.05);
}

.msg-text {
  max-width: 100%;
}

.msg-user .msg-text {
  display: inline-block;
  background: var(--agent-user-bubble);
  backdrop-filter: blur(8px);
  padding: 8px 12px;
  border-radius: 16px 16px 4px 16px;
  text-align: left;
}

.kb-chip-inline {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  background: color-mix(in srgb, var(--agent-info) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--agent-info) 30%, transparent);
  border-radius: 8px;
  font-size: 11px;
  color: color-mix(in srgb, var(--agent-info) 90%, transparent);
  vertical-align: middle;
  white-space: nowrap;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.msg-assistant .msg-text {
  display: inline-block;
  background: transparent;
  backdrop-filter: blur(var(--agent-lens-blur));
  -webkit-backdrop-filter: blur(var(--agent-lens-blur));
  padding: 6px 12px 6px 10px;
  border-left: 2px solid var(--agent-primary);
  border-radius: 0 8px 8px 0;
}

.msg-text-content {
  position: relative;
}

.msg-text-content.text-collapsed {
  max-height: 160px;
  overflow: hidden;
}

.msg-text-content.text-collapsed::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 48px;
  background: linear-gradient(transparent, var(--agent-bg));
  pointer-events: none;
}

.text-expand-btn {
  display: inline-block;
  padding: 2px 8px;
  margin-top: 4px;
  border-radius: 8px;
  font-size: 11px;
  color: var(--agent-accent);
  background: color-mix(in srgb, var(--agent-primary) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--agent-primary) 15%, transparent);
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.text-expand-btn:hover {
  background: color-mix(in srgb, var(--agent-primary) 15%, transparent);
}

.msg-text :deep(h1), .msg-text :deep(h2), .msg-text :deep(h3) {
  margin: 8px 0 4px; font-weight: var(--font-weight-semibold);
}
.msg-text :deep(h1) { font-size: var(--font-size-xl) }
.msg-text :deep(h2) { font-size: var(--font-size-lg) }
.msg-text :deep(h3) { font-size: var(--font-size-md) }
.msg-text :deep(p) { margin: 4px 0 }
.msg-text :deep(ul), .msg-text :deep(ol) { margin: 4px 0; padding-left: 20px }
.msg-text :deep(li) { margin: 2px 0 }
.msg-text :deep(code) {
  background: var(--agent-hover-bg);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: var(--font-size-sm);
  font-family: 'Consolas', 'Monaco', monospace;
}
.msg-text :deep(pre) {
  background: color-mix(in srgb, var(--agent-bg) 25%, transparent);
  padding: 10px 12px;
  border-radius: var(--agent-radius-sm);
  overflow-x: auto;
  margin: 8px 0;
}
.msg-text :deep(pre code) { background: none; padding: 0; font-size: var(--font-size-sm); line-height: 1.5 }
.msg-text :deep(blockquote) {
  border-left: 3px solid var(--agent-primary);
  margin: 6px 0; padding: 4px 12px; opacity: 0.85;
}
.msg-text :deep(table) { border-collapse: collapse; margin: 8px 0; font-size: var(--font-size-sm) }
.msg-text :deep(th), .msg-text :deep(td) {
  border: 1px solid var(--agent-border-color); padding: 4px 8px;
}
.msg-text :deep(a) { color: var(--agent-primary); text-decoration: underline }
.msg-text :deep(hr) { border: none; border-top: 1px solid var(--agent-border-color); margin: 8px 0 }

.msg-tool-calls { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.tool-call-tag {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px; border-radius: 10px; font-size: 11px;
  background: var(--agent-hover-bg); border: 1px solid var(--agent-hover-bg);
  color: var(--agent-text-secondary);
}
.tool-call-tag.completed { border-color: color-mix(in srgb, var(--agent-success) 30%, transparent); color: var(--agent-success); opacity: 0.7; }
.tool-call-tag.failed { border-color: color-mix(in srgb, var(--agent-danger) 30%, transparent); color: var(--agent-danger); }
.tool-call-summary {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px; border-radius: 10px; font-size: 11px;
  background: color-mix(in srgb, var(--agent-success) 8%, transparent); border: 1px solid color-mix(in srgb, var(--agent-success) 20%, transparent);
  color: color-mix(in srgb, var(--agent-success) 80%, transparent);
}
.tc-pulse { animation: ws-pulse 1.5s infinite; }

.msg-actions {
  display: flex; align-items: center; gap: 4px;
  margin-top: 2px; opacity: 0; transition: opacity 0.15s; height: 20px;
}
.msg-actions.visible { opacity: 1 }

.action-btn {
  background: none; border: none; cursor: pointer; font-size: var(--font-size-sm);
  padding: 2px 4px; border-radius: 4px; opacity: 0.6; transition: opacity 0.1s;
}
.action-btn:hover { opacity: 1 }

.msg-time {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  margin-left: auto;
}

.time-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  user-select: none;
}

.time-divider::before,
.time-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--agent-border);
}

.time-divider-text {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  white-space: nowrap;
  font-family: var(--agent-font);
}

.chat-msg.anim-fadeIn { animation: ws-fade-in 0.3s ease-out }
.chat-msg.anim-slideIn { animation: ws-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) }
.chat-msg.anim-typewriter { animation: ws-fade-in 0.15s ease-out }
.chat-msg.anim-pulse { animation: ws-pulse-in 0.4s ease-out }
.chat-msg.anim-bounce { animation: ws-bounce-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) }
.chat-msg.anim-wave { animation: ws-wave-in 0.5s ease-out }

@keyframes ws-fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes ws-slide-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
@keyframes ws-pulse-in { 0% { opacity: 0; transform: scale(0.95) } 50% { transform: scale(1.02) } 100% { opacity: 1; transform: scale(1) } }
@keyframes ws-bounce-in { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: translateY(0) } }
@keyframes ws-wave-in { 0% { opacity: 0; transform: translateX(-8px) } 100% { opacity: 1; transform: translateX(0) } }

.chat-msg:has(.manuscript-canvas) {
  max-width: 98%;
  flex-wrap: nowrap;
}

.chat-msg:has(.manuscript-canvas) .msg-body {
  overflow: visible;
  flex: 0 1 auto;
  min-width: 0;
}

.chat-msg:has(.manuscript-canvas) .manuscript-canvas {
  flex: 1 1 0;
  min-width: 280px;
  max-width: 60%;
  margin-left: auto;
}

/* 实体名 mention 高亮：用 :deep() 穿透 v-html 渲染的 DOM */
:deep(.ws-entity-mention) {
  color: var(--agent-accent, #b388ff);
  background: rgba(108, 92, 231, 0.1);
  border-radius: 3px;
  padding: 0 3px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  font-weight: 500;
  border-bottom: 1px dashed var(--agent-accent, #b388ff);
}
:deep(.ws-entity-mention:hover) {
  background: rgba(108, 92, 231, 0.25);
  color: var(--agent-text, #e0e0e0);
  border-bottom-style: solid;
}
</style>
