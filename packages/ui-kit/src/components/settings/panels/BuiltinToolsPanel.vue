<template>
  <div class="builtin-tools" v-show="match('内置工具 工具 能力 tool 权限 分类 builtin tools')">
    <!-- 工具概览：总数 + 分类数 + 各权限级别计数 -->
    <div class="bt-stats">
      <span class="bt-stat">共 <b>{{ totalCount }}</b> 个工具</span>
      <span class="bt-stat">分 <b>{{ TOOL_CATEGORIES.length }}</b> 类</span>
      <span class="bt-stat" :title="'只读/查询，无需确认'"><i class="bt-dot bt-dot--safe"></i>安全 {{ permCount('safe') }}</span>
      <span class="bt-stat" :title="'写入/修改，开启安全确认时需确认'"><i class="bt-dot bt-dot--moderate"></i>需确认 {{ permCount('moderate') }}</span>
      <span class="bt-stat" :title="'删除/危险操作，强制确认'"><i class="bt-dot bt-dot--dangerous"></i>危险 {{ permCount('dangerous') }}</span>
    </div>

    <!-- 分类折叠列表：点击分类标题展开/收起该分类下的工具 -->
    <div class="bt-cats">
      <div v-for="cat in TOOL_CATEGORIES" :key="cat.id" class="bt-cat">
        <button
          class="bt-cat-head"
          :aria-expanded="expanded.includes(cat.id)"
          @click="toggleCat(cat.id)"
        >
          <WsIcon :name="expanded.includes(cat.id) ? 'chevron-down' : 'chevron-right'" size="xs" />
          <span class="bt-cat-label">{{ cat.label }}</span>
          <span class="bt-cat-count">{{ cat.tools.length }}</span>
        </button>
        <!-- 展开后逐行列出工具：名称 + 描述 + 权限徽标 -->
        <div v-show="expanded.includes(cat.id)" class="bt-list">
          <div v-for="tool in cat.tools" :key="tool.name" class="bt-item">
            <div class="bt-item-main">
              <code class="bt-name">{{ tool.name }}</code>
              <span v-if="metaOf(tool.name).alwaysAvailable" class="bt-tag" title="不依赖技能激活，始终可用">常驻</span>
            </div>
            <span class="bt-desc" :title="tool.description">{{ tool.description }}</span>
            <span class="bt-perm" :class="'bt-perm--' + metaOf(tool.name).permission">{{ permLabel(metaOf(tool.name).permission) }}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="set-hint">以上为 Agent 可调用的全部内置工具。启停请前往 Skills 卡片的「工具」区块。</div>
  </div>
</template>

<script setup lang="ts">
/**
 * 内置工具面板（只读目录）
 *
 * 按 TOOL_CATEGORIES 的 20 个分类折叠展示全部内置工具：
 * 工具名 / 描述 / 权限级别徽标 / 常驻标记。
 * 只读——不含任何启停开关（启停入口在 Skills 卡片的「工具」区块）。
 *
 * 数据源：@worldsea/agent-runtime 的 TOOL_CATEGORIES（分类与工具清单）
 *        + getToolMeta（permission / alwaysAvailable 等元数据）
 * 详细说明见 docs/details/注释/packages/ui-kit/builtin-tools-panel.md
 */
import { ref } from 'vue'
import { TOOL_CATEGORIES, getToolMeta } from '@worldsea/agent-runtime'
import type { PermissionLevel } from '@worldsea/agent-core'
import { WsIcon } from '@worldsea/ui-kit'
import { matchKeywords } from '../utils'

const props = defineProps<{ searchQuery?: string }>()

// 默认折叠全部分类，避免首屏过长
const expanded = ref<string[]>([])

function toggleCat(id: string): void {
  const i = expanded.value.indexOf(id)
  expanded.value = i >= 0 ? expanded.value.filter(x => x !== id) : [...expanded.value, id]
}

/** 工具总数（分类间可能重叠，此处按分类内条目累加，与左列各分类计数口径一致） */
const totalCount = ref(TOOL_CATEGORIES.reduce((n, c) => n + c.tools.length, 0))

const PERM_LABEL: Record<PermissionLevel, string> = {
  safe: '安全',
  moderate: '需确认',
  dangerous: '危险',
}
function permLabel(p: PermissionLevel): string {
  return PERM_LABEL[p] ?? p
}

/** 按权限级别统计工具数（同名工具去重） */
function permCount(level: PermissionLevel): number {
  const seen = new Set<string>()
  let n = 0
  for (const cat of TOOL_CATEGORIES) {
    for (const t of cat.tools) {
      if (seen.has(t.name)) continue
      seen.add(t.name)
      if (getToolMeta(t.name).permission === level) n++
    }
  }
  return n
}

/** 取工具元数据（带兜底：未注册工具返回 moderate/coding） */
function metaOf(name: string) {
  return getToolMeta(name)
}

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}
</script>

<style scoped>
/* 概览统计行 */
.bt-stats { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-bottom: 12px; font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); }
.bt-stat { display: inline-flex; align-items: center; gap: 4px; }
.bt-stat b { color: var(--text-secondary, var(--color-text-secondary)); font-weight: var(--font-weight-semibold); }
/* 权限级别圆点（与下方徽标同色系） */
.bt-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.bt-dot--safe { background: var(--color-success, #4ade80); }
.bt-dot--moderate { background: var(--color-warning, #fbbf24); }
.bt-dot--dangerous { background: var(--color-error, #f87171); }

.bt-cats { display: flex; flex-direction: column; gap: 2px; }
.bt-cat { border-radius: var(--radius-sm, 4px); }

/* 分类标题行（可点击折叠） */
.bt-cat-head { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 8px; background: none; border: none; border-radius: var(--radius-sm, 4px); color: var(--text-primary, var(--color-text)); font-size: var(--font-size-sm); font-family: inherit; cursor: pointer; text-align: left; transition: background 0.15s; }
.bt-cat-head:hover { background: var(--bg-muted, var(--agent-hover-bg)); }
.bt-cat-label { flex: 1; }
.bt-cat-count { font-size: var(--font-size-2xs, 10px); color: var(--text-tertiary, var(--color-text-tertiary)); }

.bt-list { display: flex; flex-direction: column; padding: 2px 0 6px 22px; }
.bt-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: 2px 10px; padding: 5px 6px; border-radius: var(--radius-sm, 4px); }
.bt-item:hover { background: var(--bg-muted, var(--agent-hover-bg)); }
.bt-item-main { display: flex; align-items: center; gap: 6px; min-width: 0; }
/* 工具名（等宽字体，便于与代码/文档对照） */
.bt-name { font-size: var(--font-size-xs); color: var(--text-primary, var(--color-text)); font-family: var(--font-mono, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 常驻标记：不依赖技能激活 */
.bt-tag { flex-shrink: 0; padding: 0 5px; border-radius: var(--radius-sm, 4px); border: 1px solid var(--border, var(--color-border)); font-size: var(--font-size-2xs, 10px); color: var(--text-tertiary, var(--color-text-tertiary)); }
/* 描述跨整行，超长省略 */
.bt-desc { grid-column: 1 / -1; font-size: var(--font-size-2xs, 10px); color: var(--text-tertiary, var(--color-text-tertiary)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 权限徽标 */
.bt-perm { flex-shrink: 0; padding: 1px 6px; border-radius: var(--radius-pill, 999px); font-size: var(--font-size-2xs, 10px); border: 1px solid transparent; }
.bt-perm--safe { color: var(--color-success, #4ade80); border-color: color-mix(in srgb, var(--color-success, #4ade80) 35%, transparent); }
.bt-perm--moderate { color: var(--color-warning, #fbbf24); border-color: color-mix(in srgb, var(--color-warning, #fbbf24) 35%, transparent); }
.bt-perm--dangerous { color: var(--color-error, #f87171); border-color: color-mix(in srgb, var(--color-error, #f87171) 35%, transparent); }
</style>
