<!--
  ToolTerminalDetail：终端类工具展开卡（R 批 R-a）

  结构（草案 §四 A 组）：
    终端身份行（shell 身份 · cwd · 超时）→ 命令块 → 输出（live stream 优先，回落 stdout）
    → stderr（独立块）→ 尾行（exit code · 耗时 · 沙箱拒绝）→ 其余参数

  「结构由服务端给」：exit_code / duration_ms 取自结果 `__meta`（终端工具已写入），
  前端不复从输出文本里抠。
-->
<template>
  <div class="ws-stream-tool-detail ws-term">
    <div class="ws-term-head">
      <span class="ws-term-shell">{{ shellLabel }}</span>
      <span v-if="cwd" class="ws-term-meta" :title="cwd">cwd: {{ cwd }}</span>
      <span v-if="timeoutText" class="ws-term-meta">{{ timeoutText }}</span>
      <span v-if="sessionId" class="ws-term-meta">会话 {{ sessionId }}</span>
    </div>

    <pre v-if="commandText" class="ws-term-cmd"><span class="ws-term-cmd-sign">{{ commandSign }}</span>{{ commandText }}</pre>

    <!-- 输出：live 增量（含滚动跟随）优先；无增量（回源 / 已完成）回落结果 stdout -->
    <ToolDeltaOutput :item="item" />
    <div v-if="!hasStream && stdout" class="ws-term-block">
      <div class="ws-term-block-label">输出</div>
      <pre class="ws-term-block-body">{{ stdout }}</pre>
    </div>
    <div v-if="stderr" class="ws-term-block ws-term-block--err">
      <div class="ws-term-block-label">stderr</div>
      <pre class="ws-term-block-body">{{ stderr }}</pre>
    </div>

    <div class="ws-term-tail">
      <span v-if="exitText" class="ws-term-exit" :class="{ 'is-fail': exitFailed }">{{ exitText }}</span>
      <span v-if="durationText" class="ws-term-dur">{{ durationText }}</span>
      <span v-if="sandboxDenied" class="ws-term-denied" :title="sandboxHint">沙箱拒绝</span>
      <span v-if="!exitText && !durationText" class="ws-term-dur">已执行</span>
    </div>

    <div v-if="extraArgs.length" class="ws-term-args">
      <span v-for="a in extraArgs" :key="a.k" class="ws-term-arg">{{ a.k }}: {{ a.v }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import ToolDeltaOutput from './ToolDeltaOutput.vue'
import { num, parseToolResult, str } from './toolResult'
import type { ToolItem } from './types'

const props = defineProps<{
  item: ToolItem
}>()

const parsed = computed(() => parseToolResult(props.item.tc.result))

/** 终端身份（工具名 → 可读 shell 标识） */
const shellLabel = computed(() => {
  const n = props.item.tc.name
  if (n === 'powershell') return 'PowerShell'
  if (n === 'bash') return 'bash'
  if (n.startsWith('shell_session_')) return 'PTY 会话'
  if (n === 'detect_shells') return 'shell 探测'
  return n
})

const args = computed(() => props.item.tc.args as Record<string, unknown>)
const cwd = computed(() => str(args.value.cwd))
const sessionId = computed(() => str(args.value.session_id))
const timeoutText = computed(() => {
  const ms = num(args.value.timeout_ms)
  return ms ? `超时 ${Math.round(ms / 1000)}s` : ''
})

/** 命令正文：bash/powershell 用 command；会话输入用 data（以输入符标注） */
const commandText = computed(() => str(args.value.command) || str(args.value.data))
const commandSign = computed(() => (str(args.value.command) ? '$ ' : '› '))

/** 其余参数（命令 / 输入 / cwd / 会话已在上方展示，不再重复） */
const extraArgs = computed(() => {
  const skip = new Set(['command', 'data', 'cwd', 'session_id'])
  return Object.entries(args.value)
    .filter(([k]) => !skip.has(k))
    .slice(0, 6)
    .map(([k, v]) => ({ k, v: typeof v === 'object' ? JSON.stringify(v) : String(v) }))
})

const stdout = computed(() => str(parsed.value.json?.stdout))
const stderr = computed(() => str(parsed.value.json?.stderr))
/** live 增量在场时输出区已由 ToolDeltaOutput 承担，避免双份输出 */
const hasStream = computed(() => !!props.item.stream?.trim())

const exitText = computed(() => {
  const code = num(parsed.value.meta?.exit_code)
  return code === undefined ? '' : `exit ${code}`
})
const exitFailed = computed(() => (num(parsed.value.meta?.exit_code) ?? 0) !== 0)
const durationText = computed(() => {
  const ms = num(parsed.value.meta?.duration_ms)
  if (ms === undefined) return ''
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
})
const sandboxDenied = computed(() => parsed.value.meta?.sandbox_denied === true)
const sandboxHint = computed(() => str(parsed.value.json?.sandbox_hint))
</script>
