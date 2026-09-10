<template>
  <div class="agent-plugins" v-show="match('插件 plugin 扩展 打包 分发 安装 skills hooks mcp agents')">
    <!-- 首行界定语：与全局设置「插件」Tab（世界观插件开关）明确区分 -->
    <div class="ap-scope">
      Agent 插件系统 —— 将 Skills / Agents / Hooks / MCP 服务器打包为可安装、可版本化的扩展包
    </div>

    <!-- 能力面说明：插件可打包的四类组件 -->
    <div class="ap-components">
      <div v-for="c in COMPONENTS" :key="c.name" class="ap-comp">
        <span class="ap-comp-icon"><WsIcon :name="c.icon" size="sm" /></span>
        <div class="ap-comp-info">
          <span class="ap-comp-name">{{ c.name }}</span>
          <span class="ap-comp-desc">{{ c.desc }}</span>
        </div>
        <span class="ap-comp-status" :class="{ ready: c.ready }">{{ c.ready ? '已具备' : '规划中' }}</span>
      </div>
    </div>

    <!-- 空状态：功能未实现，给出后续路径 -->
    <WsEmpty
      preset="custom"
      title="Agent 插件系统尚未开始"
      description="当前版本未提供插件的打包、安装与分发能力。上方四类组件中「已具备」的部分已可独立使用，插件层将在能力聚合抽象（capability provider）立项后引入。"
    >
      <template #icon><WsIcon name="puzzle" size="xl" /></template>
    </WsEmpty>

    <div class="set-hint">
      相关规划见
      <code class="ap-doc">docs/plans/2026-09-10-Agent能力面整顿审查.md</code>
      第 D 节（立项坐标系）与 P7–P10 决策点。
      世界观插件的启用/禁用请前往「插件」设置分类。
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Agent 插件面板（能力打包分发层 · 空状态占位）
 *
 * 语义界定：此处的「插件」指 Agent 插件系统（Agent Plugins 1.0.0 标准形态的能力打包层），
 * 与全局设置「插件」分类下的 27 个世界观插件（entity-core PluginAPI 体系）**不是同一概念**——
 * 后者已归类为「内置工具系统中数据域/视图扩展的一环」。
 *
 * 现状：零代码。本面板先占信息位，说明四类可打包组件及其就绪状态。
 * 详细说明见 docs/details/注释/packages/ui-kit/agent-plugins-panel.md
 */
import { WsIcon, WsEmpty } from '@worldsea/ui-kit'
import { matchKeywords } from '../utils'

const props = defineProps<{ searchQuery?: string }>()

/**
 * 插件可打包的四类组件（依 Agent Plugins 1.0.0：v1 标准化 Agent Skills + MCP servers，
 * hooks 与自定义 agents 在路线图）。ready 表示本项目对应能力是否已独立存在。
 */
const COMPONENTS = [
  { name: 'Agent Skills', icon: 'star', desc: 'SKILL.md + 渐进披露的能力包', ready: true },
  { name: 'MCP 服务器', icon: 'link', desc: '外部工具源接入配置', ready: true },
  { name: 'Hooks', icon: 'lightning', desc: '生命周期钩子（kernel 已有 tool_hook 位点）', ready: false },
  { name: 'Agents', icon: 'bot', desc: '自定义子 Agent 定义', ready: false },
]

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}
</script>

<style scoped>
/* 界定语：与全局「插件」Tab 区分 */
.ap-scope { font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); margin-bottom: 12px; line-height: var(--line-height-relaxed, 1.6); }

.ap-components { display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px; }
.ap-comp { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--radius-sm, 4px); }
.ap-comp:hover { background: var(--bg-muted, var(--agent-hover-bg)); }
.ap-comp-icon { display: inline-flex; color: var(--text-tertiary, var(--color-text-tertiary)); flex-shrink: 0; }
.ap-comp-info { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
.ap-comp-name { font-size: var(--font-size-sm); color: var(--text-primary, var(--color-text)); }
.ap-comp-desc { font-size: var(--font-size-2xs, 10px); color: var(--text-tertiary, var(--color-text-tertiary)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 就绪状态标签 */
.ap-comp-status { flex-shrink: 0; padding: 1px 6px; border-radius: var(--radius-pill, 999px); border: 1px solid var(--border, var(--color-border)); font-size: var(--font-size-2xs, 10px); color: var(--text-tertiary, var(--color-text-tertiary)); }
.ap-comp-status.ready { color: var(--color-success, #4ade80); border-color: color-mix(in srgb, var(--color-success, #4ade80) 35%, transparent); }

.ap-doc { font-size: var(--font-size-2xs, 10px); font-family: var(--font-mono, monospace); color: var(--text-secondary, var(--color-text-secondary)); }
</style>
