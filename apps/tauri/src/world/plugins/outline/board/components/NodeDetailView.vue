<template>
  <div v-if="node" class="ndv">
    <div class="bi-sec">
      <div class="bi-sec-title">节点属性<span class="bi-sec-note">写入大纲节点</span></div>

      <label class="bi-field">
        <span class="bi-field-label">状态</span>
        <select
          class="bi-select"
          :value="statusValue"
          @change="$emit('updateNodeField', 'status', ($event.target as HTMLSelectElement).value, '改状态')"
        >
          <option v-for="s in STATUS_OPTIONS" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>

      <!-- 节点类型（2026-09-18 Q6-① 补齐）：此前该字段只有 Agent 侧能读写
           （`create_node`/`batch_create` 写入、`get_structure` 返回、SKILL.md 记载），
           而 UI 完全不可见、不可编辑 —— 这是能力缺口。
           取值**保留英文四值**（Agent 工具与 SKILL.md 已按此口径），中文只作显示标签。 -->
      <label class="bi-field">
        <span class="bi-field-label">节点类型</span>
        <select
          class="bi-select"
          :value="nodeTypeValue"
          @change="$emit('updateNodeField', 'nodeType', ($event.target as HTMLSelectElement).value, '改节点类型')"
        >
          <option value="">（未设）</option>
          <option v-for="t in NODE_TYPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
      </label>

      <label class="bi-field">
        <span class="bi-field-label">所属线索</span>
        <input
          class="bi-text"
          type="text"
          placeholder="多个用逗号分隔"
          :value="storylinesValue"
          @change="$emit('updateNodeField', 'storylines', ($event.target as HTMLInputElement).value, '改线索')"
        />
      </label>

      <label class="bi-field">
        <span class="bi-field-label">字数</span>
        <input
          class="bi-num"
          type="number"
          min="0"
          :value="wordCountValue"
          @change="$emit('updateNodeField', 'wordCount', Number(($event.target as HTMLInputElement).value), '改字数')"
        />
      </label>

      <!-- 关联章节：**不再允许手填 ID**（2026-09-18 收敛）。
           手填 ID 是「章节↔节点」双字段双轨缺陷的入口：填了它只改大纲侧，
           章节侧看不见；而章节侧的关联也传不过来。现在关联的唯一入口是
           右栏「章节」tab（拖入 / 双击 / 拖到节点项上），写入统一经 `@/entity/chapterLink`。
           这里只做**呈现 + 解除**，不再提供编辑。 -->
      <div class="bi-field">
        <span class="bi-field-label">关联章节</span>
        <div class="bi-link-row">
          <span v-if="linkedChapterName" class="bi-link-name" :title="linkedChapterName">{{ linkedChapterName }}</span>
          <span v-else class="bi-link-empty">未关联（在右栏「章节」中拖入）</span>
          <button
            v-if="linkedChapterName"
            class="bi-link-unbind"
            type="button"
            title="解除关联（不删除节点与章节）"
            @click="$emit('unlinkChapter')"
          >解除</button>
        </div>
      </div>
      <NodeRefsSection :node="node" />
      <NodeLateralSection :node="node" />
    </div>

    <div class="bi-foot">
      <button class="bi-btn" type="button" :disabled="!hasManuscript" @click="$emit('openNode')">
        打开节点正文
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 大纲节点详情（2026-10-08 自 BoardInspector 拆出，随「outline 接入详情载体」裁定）。
 *
 * 拆分口径：**节点属性是「详情」**（与其余 19 芽的实体详情同质，可吃 L1 载体）；
 * 「容器尺寸 / 表现形式配置」是白板**编辑工具**，留守画布内悬浮面板（BoardInspector）。
 * 本件被 NodeDetailDock 装进载体注册表；写入纪律不变——只上报意图，合并与撤销由装配层负责。
 */
import { computed } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import { NODE_STATUSES, statusOf } from '../forms/progressStats'
import NodeRefsSection from './NodeRefsSection.vue'
import NodeLateralSection from './NodeLateralSection.vue'

/** 状态三态（与节点注册的 deteriorable trait 选项一致，勿另造值） */
const STATUS_OPTIONS = NODE_STATUSES

/**
 * 节点类型四值（与 `outline/index.ts` 的 `nodeType` ownField 选项**保持一致**，
 * 也与 SKILL.md 记载、Agent 工具写入口径一致）。
 * **value 是英文**（存量与 Agent 口径）、**label 是中文**（显示）。
 */
const NODE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'act', label: '幕' },
  { value: 'sequence', label: '序列' },
  { value: 'scene', label: '场景' },
  { value: 'beat', label: '节拍' },
]

const props = defineProps<{
  node?: Entity
  /**
   * 已关联章节的**名字**（由装配层跨芽查得）。
   * 面板只呈现名字而不呈现 ID——ID 对用户无意义，而名字能让人确认「关联对了没有」。
   */
  linkedChapterName?: string
}>()

defineEmits<{
  /** 改节点字段（写 properties 的合并与撤销登记由装配层负责——本组件只上报意图） */
  (e: 'updateNodeField', key: string, value: unknown, label: string): void
  /** 解除章节关联（两侧字段都清；节点与章节都不删） */
  (e: 'unlinkChapter'): void
  /** 打开节点正文 */
  (e: 'openNode'): void
}>()

// ── 节点字段现值（派生自 node，不本地缓存：外部改动应立刻反映到面板）──
const statusValue = computed(() => statusOf(props.node))
const storylinesValue = computed(() => String(props.node?.properties?.storylines ?? ''))
const wordCountValue = computed(() => Number(props.node?.properties?.wordCount ?? 0) || 0)
/** 节点类型现值（空串 = 未设，下拉里有「（未设）」项可选回空） */
const nodeTypeValue = computed(() => String(props.node?.properties?.nodeType ?? ''))
const hasManuscript = computed(() => !!(props.node?.properties?.manuscriptId as string))
</script>

<style scoped>
.ndv { display: flex; flex-direction: column; }
.bi-sec { padding: 8px 0; border-bottom: 1px solid var(--border-light); }
.bi-sec-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
.bi-sec-note { color: var(--text-tertiary); opacity: 0.8; }
.bi-field { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.bi-field-label { font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.bi-select,
.bi-text {
  max-width: 140px;
  height: 22px;
  padding: 0 4px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: var(--input-bg);
  color: var(--text-color);
  font-size: var(--font-size-2xs);
  font-family: inherit;
  outline: none;
}
.bi-num {
  width: 56px;
  height: 22px;
  padding: 0 4px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: var(--input-bg);
  color: var(--text-color);
  font-size: var(--font-size-2xs);
  font-family: inherit;
  outline: none;
}
/* 关联章节：只读呈现 + 解除（不再手填 ID，见模板注释） */
.bi-link-row { display: flex; align-items: center; gap: 4px; min-width: 0; flex: 1; justify-content: flex-end; }
.bi-link-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-xs);
  color: var(--primary);
}
.bi-link-empty { font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.bi-link-unbind {
  flex-shrink: 0;
  padding: 1px 6px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: transparent;
  /* 显式设色：暗色主题下不设会继承成不可见（项目通用坑） */
  color: var(--text-secondary);
  font-size: var(--font-size-2xs);
  font-family: inherit;
  cursor: pointer;
}
.bi-link-unbind:hover { border-color: var(--danger); color: var(--danger); }
.bi-btn {
  margin-top: 6px;
  width: 100%;
  height: 24px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: transparent;
  /* 按钮文字必须显式设色（否则暗色主题回落到默认黑） */
  color: var(--text-secondary);
  font-size: var(--font-size-2xs);
  cursor: pointer;
}
.bi-btn:hover:not(:disabled) { background: var(--hover-bg); border-color: var(--primary); color: var(--primary); }
.bi-btn:disabled { opacity: 0.5; cursor: default; }
.bi-foot { padding-top: 8px; }
</style>
