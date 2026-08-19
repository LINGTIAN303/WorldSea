<template>
  <div class="router-panel">
    <!-- 运行区：路由操作（默认显区） -->
    <div class="rp-run">
      <div class="rp-run-head">
        <span class="rp-label">意图路由</span>
        <label class="rp-strategy">
          <input type="checkbox" v-model="useLlm" :disabled="busy" />
          <span>LLM 意图分类</span>
        </label>
      </div>
      <div class="rp-run-row">
        <input
          v-model="inputText"
          class="rp-input"
          placeholder="输入内容，路由到合适的处理分支…"
          :disabled="busy"
          @keydown.enter.prevent="run"
        />
        <button class="rp-run-btn" :disabled="busy || !inputText.trim()" @click="run">
          <template v-if="busy">路由中…</template>
          <template v-else>路由</template>
        </button>
      </div>
      <div v-if="error" class="rp-error">{{ error }}</div>
    </div>

    <!-- 决策结果区 -->
    <div v-if="decision" class="rp-result">
      <div class="rp-result-label">决策结果</div>
      <div class="rp-decision-card">
        <div class="rp-decision-hd">
          <span class="rp-decision-target">
            <WsIcon name="corner-down-right" :size="14" :stroke-width="1.7" />
            {{ decision.targetName }}
          </span>
          <span v-if="decision.isFallback" class="rp-fallback-tag">fallback</span>
        </div>
        <div class="rp-decision-id">{{ decision.targetId }}</div>
        <div v-if="decision.reason" class="rp-decision-reason">
          {{ decision.reason }}
        </div>
      </div>
    </div>
    <div v-else-if="!decision" class="rp-empty">
      <TuiEmpty icon="route" :fill="false" title="尚未执行路由" hint="输入内容并点击「路由」进行意图分流" />
    </div>

    <!-- 配置区：路由目标（默认折叠，弱提示分级显隐） -->
    <div class="rp-config">
      <button
        class="rp-collapse"
        :aria-expanded="configOpen"
        @click="configOpen = !configOpen"
      >
        <WsIcon name="chevron-right" :size="13" :stroke-width="1.7" :class="{ spin90: configOpen }" />
        <span>路由目标（{{ targetCount }}）</span>
        <span class="rp-config-hint">配置</span>
      </button>
      <div v-show="configOpen" class="rp-config-body">
        <div class="rp-target-list">
          <div v-for="(t, i) in editable" :key="i" class="rp-target-row">
            <div class="rp-target-fields">
              <input v-model="t.name" class="rp-cell" placeholder="名称" aria-label="目标名称" />
              <input v-model="t.id" class="rp-cell rp-cell-id" placeholder="ID" aria-label="目标ID" />
            </div>
            <div class="rp-target-meta">
              <input v-model="t.description" class="rp-cell rp-cell-desc" placeholder="能力描述（LLM 分类参考）" aria-label="能力描述" />
              <input v-model="keywordsText[i]" class="rp-cell" placeholder="关键词（逗号分隔，用于关键词策略）" aria-label="关键词" />
            </div>
            <button class="rp-cell-del" :disabled="busy" :aria-label="`删除目标 ${t.name || t.id}`" @click="removeTarget(i)"><WsIcon name="trash" :size="13" :stroke-width="1.7" /></button>
          </div>
        </div>
        <button class="rp-add" :disabled="busy" @click="addTarget"><WsIcon name="plus" :size="13" :stroke-width="1.7" />添加目标</button>
        <div class="rp-fallback">
          <label class="rp-strategy">
            <span>fallback 目标 ID</span>
            <input v-model="fallbackText" class="rp-cell rp-cell-id" placeholder="无匹配时兜底 (可选)" :disabled="busy" aria-label="fallback 目标ID" />
          </label>
        </div>
        <div class="rp-config-actions">
          <button class="rp-save" :disabled="busy || !editable.length" @click="saveConfig">保存配置</button>
          <button v-if="hasConfig" class="rp-destroy" :disabled="busy" @click="destroy">清除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * RouterPanel：Router Pattern 轻量面板（编排 4 模式 UI 下沉之 Router 样板）。
 * 四段式：运行区（意图路由）/ 决策结果区 / 配置区（折叠，分级显隐）。
 * 视觉遵循 agent-ux-guidelines：克制弱提示、折叠收纳、错误/空态统一。
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import TuiEmpty from '@/components/ui/TuiEmpty.vue'
import { useRouterRust, type RouterTarget } from '../composables/useRouterRust'

const { busy, error, routerState, create, route, setTargets, refreshState, destroy } = useRouterRust()

// 中间层（模板避免对 readonly ref 深度可选链，保持类型稳定）
const decision = computed(() => routerState.value?.lastDecision ?? null)
const hasConfig = computed(() => !!routerState.value)
const targetCount = computed(() => routerState.value?.targets.length ?? editable.length)

// 配置区折叠（分级显隐：默认折叠次要配置）
const configOpen = ref(false)
const useLlm = ref(true)
// 表单态 targets（增删改后点「保存」才提交后端）
const editable = reactive<RouterTarget[]>([])
const keywordsText = ref<string[]>([])
const fallbackText = ref('')
const inputText = ref('')

/** 示例目标（默认预置，便于快速体验） */
const DEFAULT_TARGETS: RouterTarget[] = [
  { id: 'coder', name: '代码专家', description: '处理代码编写、调试、重构类任务', keywords: ['代码', '函数', 'bug', '重构'] },
  { id: 'writer', name: '文档专家', description: '处理文档撰写、翻译、润色类任务', keywords: ['文档', '翻译', '润色', '写'] },
  { id: 'research', name: '研究助手', description: '处理资料搜集、分析、总结类任务', keywords: ['研究', '分析', '总结', '调研'] },
]

function setEditable(list: RouterTarget[]) {
  editable.splice(0, editable.length, ...list.map(t => ({ ...t })))
  keywordsText.value = list.map(t => (t.keywords ?? []).join(', '))
}

function addTarget() {
  editable.push({ id: `t${Date.now()}`, name: '', description: '', keywords: null })
  keywordsText.value.push('')
}

function removeTarget(i: number) {
  editable.splice(i, 1)
  keywordsText.value.splice(i, 1)
}

function toTargets(): RouterTarget[] {
  return editable.map((t, i) => ({
    id: t.id.trim(),
    name: t.name.trim(),
    description: t.description.trim(),
    keywords: keywordsText.value[i]?.trim()
      ? keywordsText.value[i].split(/[,，]/).map(s => s.trim()).filter(Boolean)
      : null,
  })).filter(t => t.id && t.name)
}

async function saveConfig() {
  const list = toTargets()
  if (!list.length) { return }
  try {
    if (routerState.value) {
      await setTargets(list, useLlm.value, fallbackText.value.trim() || null)
    } else {
      await create(list, useLlm.value, fallbackText.value.trim() || null)
    }
    configOpen.value = false
  } catch { /* 错误已写入 error */ }
}

async function run() {
  const input = inputText.value.trim()
  if (!input || busy.value) return
  try {
    // 未配置时先自动保存当前表单为配置
    if (!routerState.value) {
      const list = toTargets()
      if (list.length) await create(list, useLlm.value, fallbackText.value.trim() || null)
    }
    await route(input)
  } catch { /* 错误已写入 error */ }
}

onMounted(async () => {
  const st = await refreshState()
  if (st) {
    useLlm.value = st.useLlm
    fallbackText.value = st.fallbackTargetId ?? ''
    if (st.targets.length) setEditable(st.targets)
  } else {
    setEditable(DEFAULT_TARGETS)
  }
})
</script>

<style scoped>
.router-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rp-label {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.rp-run-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.rp-strategy {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-xs);
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
}
.rp-strategy input { accent-color: var(--accent); cursor: pointer; }

.rp-run-row { display: flex; gap: 8px; }

.rp-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-muted);
  color: var(--text-primary);
  font-size: var(--fs-sm);
  font-family: inherit;
}
.rp-input:focus { outline: none; border-color: var(--accent); }
.rp-input:disabled { opacity: 0.6; }

.rp-run-btn {
  border: none;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--on-accent);
  font-size: var(--fs-xs);
  font-weight: 600;
  padding: 0 14px;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
}
.rp-run-btn:hover:not(:disabled) { filter: brightness(1.05); }
.rp-run-btn:active:not(:disabled) { transform: scale(var(--press-scale)); }
.rp-run-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.rp-error {
  margin-top: 8px;
  font-size: var(--fs-xs);
  color: var(--danger, #e5484d);
  word-break: break-word;
}

/* 决策结果 */
.rp-result-label { font-size: var(--fs-xs); color: var(--text-secondary); margin-bottom: 6px; }
.rp-decision-card {
  padding: 10px 12px;
  border-radius: var(--radius-card);
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
}
.rp-decision-hd { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.rp-decision-target { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: var(--fs-sm); color: var(--accent-text, var(--text-primary)); }
.rp-fallback-tag { font-size: var(--fs-2xs); font-weight: 600; text-transform: uppercase; padding: 1px 6px; border-radius: 3px; background: var(--bg-surface); border: 1px solid var(--border); color: var(--text-muted); }
.rp-decision-id { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 2px; font-family: var(--font-mono); }
.rp-decision-reason { font-size: var(--fs-xs); color: var(--text-secondary); line-height: 1.4; margin-top: 6px; }
.rp-empty { padding-top: 8px; }

/* 配置区 */
.rp-config { border-top: 1px solid var(--border); padding-top: 2px; }
.rp-collapse {
  display: flex; align-items: center; gap: 5px;
  padding: 4px 0; width: 100%;
  background: none; border: none;
  font-size: var(--fs-xs); color: var(--text-secondary);
  cursor: pointer; user-select: none;
}
.rp-collapse:hover { color: var(--text-primary); }
.rp-collapse .spin90 { transition: transform 0.2s; }
.rp-collapse .spin90.spin90 { transform: rotate(90deg); }
.rp-config-hint { margin-left: auto; font-size: var(--fs-2xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: .4px; }

.rp-config-body { display: flex; flex-direction: column; gap: 8px; padding: 6px 0 2px; }

.rp-target-list { display: flex; flex-direction: column; gap: 6px; }
.rp-target-row {
  display: flex; align-items: flex-start; gap: 6px;
  padding: 8px; border-radius: var(--radius-sm);
  background: var(--bg-muted); border: 1px solid var(--border);
}
.rp-target-fields, .rp-target-meta { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
.rp-cell {
  width: 100%; box-sizing: border-box;
  padding: 4px 8px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--bg-surface);
  color: var(--text-primary); font-size: var(--fs-xs); font-family: inherit;
}
.rp-cell:focus { outline: none; border-color: var(--accent); }
.rp-cell-id { font-family: var(--font-mono); font-size: var(--fs-2xs); }
.rp-cell-desc { font-size: var(--fs-xs); }
.rp-cell-del {
  flex-shrink: 0; border: none; background: none;
  color: var(--text-muted); cursor: pointer; padding: 4px;
  border-radius: var(--radius-sm);
}
.rp-cell-del:hover { color: var(--danger, #e5484d); background: var(--bg-surface); }

.rp-add, .rp-save, .rp-destroy {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: var(--fs-xs); border-radius: var(--radius-sm);
  cursor: pointer; transition: opacity 0.15s;
}
.rp-add { border: 1px dashed var(--border); background: none; color: var(--text-muted); padding: 5px 10px; }
.rp-add:hover { color: var(--accent); border-color: var(--accent); }
.rp-add:disabled { opacity: 0.5; cursor: not-allowed; }
.rp-fallback .rp-strategy { gap: 8px; font-size: var(--fs-xs); color: var(--text-secondary); }
.rp-fallback .rp-cell { max-width: 180px; }
.rp-config-actions { display: flex; gap: 8px; margin-top: 2px; }
.rp-save {
  border: none; background: var(--accent); color: var(--on-accent);
  font-weight: 600; padding: 6px 14px;
}
.rp-save:hover:not(:disabled) { filter: brightness(1.05); }
.rp-save:disabled { opacity: 0.5; cursor: not-allowed; }
.rp-destroy {
  border: 1px solid var(--border); background: none; color: var(--text-muted); padding: 6px 12px;
}
.rp-destroy:hover { color: var(--danger, #e5484d); border-color: var(--danger, #e5484d); }
.rp-destroy:disabled { opacity: 0.5; cursor: not-allowed; }

@media (prefers-reduced-motion: reduce) {
  .rp-collapse .spin90, .rp-run-btn:active:not(:disabled) { transition: none; transform: none; }
}
</style>