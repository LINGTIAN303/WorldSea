<template>
  <div class="acp-body">
    <!-- 加载中 -->
    <div v-if="loading" class="acp-loading">加载配置中...</div>
    <template v-else-if="config">
      <!-- 归档触发 -->
      <div class="acp-section">
        <div class="acp-section-label">归档触发</div>
        <div class="acp-row">
          <span class="acp-label">归档阈值 (tokens)</span>
          <input
            v-model.number="config.archiveThreshold"
            type="number"
            class="acp-input"
            min="50000"
            max="2000000"
            step="50000"
          />
        </div>
        <div class="acp-row">
          <span class="acp-label">最小归档消息数</span>
          <input
            v-model.number="config.minArchiveMessages"
            type="number"
            class="acp-input"
            min="2"
            max="100"
            step="2"
          />
        </div>
        <div class="acp-row acp-row-toggles">
          <label class="acp-toggle">
            <input type="checkbox" v-model="config.triggers.onTokenThreshold" />
            <span>Token 阈值触发</span>
          </label>
          <label class="acp-toggle">
            <input type="checkbox" v-model="config.triggers.onSessionEnd" />
            <span>会话结束触发</span>
          </label>
          <label class="acp-toggle">
            <input type="checkbox" v-model="config.triggers.manual" />
            <span>允许手动触发</span>
          </label>
        </div>
      </div>

      <!-- 周期任务（P4 新增） -->
      <div class="acp-section">
        <div class="acp-section-label">周期任务</div>
        <div class="acp-row acp-row-toggles">
          <label class="acp-toggle">
            <input type="checkbox" v-model="config.scheduler.enabled" />
            <span>启用自动调度</span>
          </label>
        </div>
        <div class="acp-row">
          <span class="acp-label">日任务执行时间</span>
          <select v-model.number="config.scheduler.dailyHour" class="acp-select">
            <option v-for="h in 24" :key="h - 1" :value="h - 1">{{ h - 1 }}:00</option>
          </select>
        </div>
        <div class="acp-row">
          <span class="acp-label">周任务执行日</span>
          <select v-model.number="config.scheduler.weeklyDay" class="acp-select">
            <option :value="0">周日</option>
            <option :value="1">周一</option>
            <option :value="2">周二</option>
            <option :value="3">周三</option>
            <option :value="4">周四</option>
            <option :value="5">周五</option>
            <option :value="6">周六</option>
          </select>
        </div>
        <div class="acp-row">
          <span class="acp-label">月任务执行日</span>
          <input
            v-model.number="config.scheduler.monthlyDay"
            type="number"
            class="acp-input"
            min="1"
            max="28"
            step="1"
          />
        </div>
      </div>

      <!-- 衰减策略 -->
      <div class="acp-section">
        <div class="acp-section-label">衰减策略</div>
        <div class="acp-row">
          <span class="acp-label">半衰期 (天)</span>
          <input
            v-model.number="config.decay.halfLifeDays"
            type="number"
            class="acp-input"
            min="1"
            max="365"
            step="1"
          />
        </div>
        <div class="acp-row">
          <span class="acp-label">淘汰阈值</span>
          <input
            v-model.number="config.decay.deprecatedThreshold"
            type="number"
            class="acp-input"
            min="0"
            max="1"
            step="0.05"
          />
        </div>
        <div class="acp-row">
          <span class="acp-label">硬删除天数</span>
          <input
            v-model.number="config.decay.deleteAfterDays"
            type="number"
            class="acp-input"
            min="7"
            max="365"
            step="1"
          />
        </div>
      </div>

      <!-- 注入策略 -->
      <div class="acp-section">
        <div class="acp-section-label">注入策略</div>
        <div class="acp-row">
          <span class="acp-label">
            自动注入最近钩子数
            <span class="acp-tooltip-icon" title="新会话创建时，自动注入最近 N 条钩子摘要到上下文。设为 0 则关闭自动注入。">ⓘ</span>
          </span>
          <input
            v-model.number="config.injection.autoInjectRecentCount"
            type="number"
            class="acp-input"
            min="0"
            max="10"
            step="1"
          />
        </div>
        <div class="acp-row">
          <span class="acp-label">
            注入摘要最大 tokens
            <span class="acp-tooltip-icon" title="单次注入的摘要文本最大 token 数量。过大会占用上下文窗口，过小可能丢失关键信息。">ⓘ</span>
          </span>
          <input
            v-model.number="config.injection.maxSummaryTokens"
            type="number"
            class="acp-input"
            min="500"
            max="10000"
            step="500"
          />
        </div>
        <!-- H4.3: 归档后注入摘要数量上限 -->
        <div class="acp-row">
          <span class="acp-label">
            归档后注入摘要数
            <span class="acp-tooltip-icon" title="归档完成后，向当前会话注入的摘要数量上限。与自动注入不同，这是归档后立即注入刚生成的摘要。">ⓘ</span>
          </span>
          <input
            v-model.number="maxInjectedSummaries"
            type="number"
            class="acp-input"
            min="0"
            max="10"
            step="1"
          />
        </div>
      </div>

      <!-- H2.5 检索配置 -->
      <div class="acp-section">
        <div class="acp-section-label">检索配置</div>
        <div class="acp-row">
          <span class="acp-label">
            默认最低相似度
            <span class="acp-tooltip-icon" title="检索结果的最低相关性分数（0-1）。分数低于此值的记忆不会被返回。降低此值可获得更多结果但可能不太相关。">ⓘ</span>
          </span>
          <input
            v-model.number="defaultMinScore"
            type="number"
            class="acp-input"
            min="0"
            max="1"
            step="0.05"
          />
        </div>
      </div>

      <!-- H1.4 归档阈值动态范围 -->
      <div class="acp-section">
        <div class="acp-section-label">
          归档阈值动态范围
          <span class="acp-tooltip-icon" title="归档阈值的动态调整范围。当消息长度接近阈值下限时开始准备归档，到达上限时强制归档。避免硬性阈值导致归档时机不理想。">ⓘ</span>
        </div>
        <div class="acp-row">
          <span class="acp-label">阈值下限 (tokens)</span>
          <input
            v-model.number="archiveThresholdMin"
            type="number"
            class="acp-input"
            min="50000"
            max="2000000"
            step="50000"
          />
        </div>
        <div class="acp-row">
          <span class="acp-label">阈值上限 (tokens)</span>
          <input
            v-model.number="archiveThresholdMax"
            type="number"
            class="acp-input"
            min="50000"
            max="2000000"
            step="50000"
          />
        </div>
      </div>

      <!-- H5.2 回收站配置 -->
      <div class="acp-section">
        <div class="acp-section-label">
          回收站
          <span class="acp-tooltip-icon" title="删除钩子时先移入回收站（软删除），超过保留天数后由月任务自动永久删除。">ⓘ</span>
        </div>
        <div class="acp-row">
          <span class="acp-label">保留天数</span>
          <input
            v-model.number="trashRetentionDays"
            type="number"
            class="acp-input"
            min="1"
            max="90"
            step="1"
          />
        </div>
      </div>

      <!-- H7.4 缓存配置 -->
      <div class="acp-section">
        <div class="acp-section-label">
          缓存
          <span class="acp-tooltip-icon" title="钩子元数据的内存缓存数量上限。使用 LRU（最近最少使用）算法淘汰。设为 0 表示不限制缓存大小。">ⓘ</span>
        </div>
        <div class="acp-row">
          <span class="acp-label">钩子缓存上限</span>
          <input
            v-model.number="hooksCacheMaxSize"
            type="number"
            class="acp-input"
            min="0"
            max="2000"
            step="50"
          />
        </div>
      </div>

      <!-- 分块策略 -->
      <div class="acp-section">
        <div class="acp-section-label">分块策略</div>
        <div class="acp-row">
          <span class="acp-label">最小块 tokens</span>
          <input
            v-model.number="config.chunking.minChunkTokens"
            type="number"
            class="acp-input"
            min="500"
            max="10000"
            step="500"
          />
        </div>
        <div class="acp-row">
          <span class="acp-label">最大块 tokens</span>
          <input
            v-model.number="config.chunking.maxChunkTokens"
            type="number"
            class="acp-input"
            min="5000"
            max="100000"
            step="5000"
          />
        </div>
      </div>

      <!-- 摘要配置 -->
      <div class="acp-section">
        <div class="acp-section-label">摘要配置</div>
        <div class="acp-row acp-row-toggles">
          <label class="acp-toggle">
            <input type="checkbox" v-model="config.summary.enabled" />
            <span>启用摘要</span>
          </label>
        </div>
        <div class="acp-row">
          <span class="acp-label">摘要方式</span>
          <select v-model="config.summary.method" class="acp-select">
            <option value="llm">LLM（高质量）</option>
            <option value="rule">规则（降级）</option>
          </select>
        </div>
        <div class="acp-row">
          <span class="acp-label">摘要最大长度</span>
          <input
            v-model.number="config.summary.maxLength"
            type="number"
            class="acp-input"
            min="1000"
            max="20000"
            step="500"
          />
        </div>
      </div>

      <!-- Embedding 配置 -->
      <div class="acp-section">
        <div class="acp-section-label">Embedding 配置</div>
        <div class="acp-row">
          <span class="acp-label">模型</span>
          <input
            v-model="config.embedding.model"
            type="text"
            class="acp-input"
            placeholder="text-embedding-3-small"
          />
        </div>
        <div class="acp-row">
          <span class="acp-label">维度</span>
          <input
            v-model.number="config.embedding.dimension"
            type="number"
            class="acp-input"
            min="256"
            max="4096"
            step="128"
          />
        </div>
        <div class="acp-row">
          <span class="acp-label">批大小</span>
          <input
            v-model.number="config.embedding.batchSize"
            type="number"
            class="acp-input"
            min="1"
            max="500"
            step="10"
          />
        </div>
      </div>

      <!-- 存储限制 -->
      <div class="acp-section">
        <div class="acp-section-label">存储限制</div>
        <div class="acp-row">
          <span class="acp-label">最大钩子数</span>
          <input
            v-model.number="config.maxHooks"
            type="number"
            class="acp-input"
            min="100"
            max="10000"
            step="100"
          />
        </div>
        <div class="acp-row">
          <span class="acp-label">最大存储 (MB)</span>
          <input
            v-model.number="config.maxStorageMB"
            type="number"
            class="acp-input"
            min="50"
            max="5000"
            step="50"
          />
        </div>
      </div>

      <!-- 排除模式 -->
      <div class="acp-section">
        <div class="acp-section-label">排除模式（正则表达式，每行一个）</div>
        <textarea
          v-model="exclusionPatternsText"
          class="acp-textarea"
          placeholder="例如：&#10;^system:&#10;^tool_result:"
          rows="3"
        ></textarea>
      </div>

      <!-- 操作按钮 -->
      <div class="acp-actions">
        <button class="acp-btn" @click="resetToDefault">
          <WsIcon name="undo" size="xs" /> 恢复默认
        </button>
        <button class="acp-btn acp-primary" @click="save" :disabled="saving">
          <WsIcon name="save" size="xs" /> {{ saving ? '保存中...' : '保存配置' }}
        </button>
      </div>
    </template>
    <div v-else class="acp-loading">无法加载配置</div>
  </div>
</template>

<script setup lang="ts">
/**
 * ArchiveConfigPanel - 归档参数配置面板
 *
 * P3-4-2 新增：提供归档参数的可视化配置界面。
 *
 * 配置项分组：
 * 1. 归档触发：阈值、最小消息数、3 个触发开关
 * 2. 衰减策略：半衰期、淘汰阈值、硬删除天数
 * 3. 注入策略：自动注入数、最大摘要 tokens
 * 4. 分块策略：最小/最大块 tokens
 * 5. 摘要配置：启用开关、方式、最大长度
 * 6. Embedding：模型、维度、批大小
 * 7. 存储限制：最大钩子数、最大存储 MB
 * 8. 排除模式：正则表达式列表
 *
 * 保存时通过 useMemoryArchive.saveConfig 持久化到 localStorage。
 */
import { ref, watch, computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useMemoryArchive } from '../memory-archive'
import { DEFAULT_ARCHIVE_CONFIG } from '@worldsmith/memory-archive'
import type { ArchiveConfig } from '@worldsmith/memory-archive'

const emit = defineEmits<{
  saved: []
}>()

const memoryArchive = useMemoryArchive()

const config = ref<ArchiveConfig | null>(null)
const loading = ref(true)
const saving = ref(false)

/** 排除模式的文本编辑（每行一个正则） */
const exclusionPatternsText = ref('')

/** 是否有未保存的修改 */
const dirty = ref(false)

// H 系列新增配置项的双向绑定（通过 computed 读写 config 顶层字段）
const maxInjectedSummaries = computed({
  get: () => config.value?.maxInjectedSummaries ?? 3,
  set: (v: number) => { if (config.value) { config.value.maxInjectedSummaries = v; dirty.value = true } },
})
const defaultMinScore = computed({
  get: () => config.value?.defaultMinScore ?? 0.25,
  set: (v: number) => { if (config.value) { config.value.defaultMinScore = v; dirty.value = true } },
})
const archiveThresholdMin = computed({
  get: () => config.value?.archiveThresholdMin ?? 300000,
  set: (v: number) => { if (config.value) { config.value.archiveThresholdMin = v; dirty.value = true } },
})
const archiveThresholdMax = computed({
  get: () => config.value?.archiveThresholdMax ?? 500000,
  set: (v: number) => { if (config.value) { config.value.archiveThresholdMax = v; dirty.value = true } },
})
const trashRetentionDays = computed({
  get: () => config.value?.trashRetentionDays ?? 7,
  set: (v: number) => { if (config.value) { config.value.trashRetentionDays = v; dirty.value = true } },
})
const hooksCacheMaxSize = computed({
  get: () => config.value?.hooksCacheMaxSize ?? 200,
  set: (v: number) => { if (config.value) { config.value.hooksCacheMaxSize = v; dirty.value = true } },
})

/** 加载配置 */
function loadConfig(): void {
  loading.value = true
  try {
    if (!memoryArchive.isInitialized.value) {
      config.value = null
      return
    }
    config.value = memoryArchive.getConfig()
    exclusionPatternsText.value = config.value.exclusionPatterns.join('\n')
    dirty.value = false
  } catch (err) {
    console.warn('[ArchiveConfigPanel] 加载配置失败:', err)
    config.value = null
  } finally {
    loading.value = false
  }
}

/** 保存配置 */
async function save(): Promise<void> {
  if (!config.value || saving.value) return
  saving.value = true
  try {
    // 解析排除模式文本
    const patterns = exclusionPatternsText.value
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    // 验证正则有效性
    for (const p of patterns) {
      try {
        new RegExp(p)
      } catch {
        console.warn('[ArchiveConfigPanel] 无效正则，已跳过:', p)
      }
    }

    await memoryArchive.saveConfig({
      ...config.value,
      exclusionPatterns: patterns,
    })
    dirty.value = false
    emit('saved')
    console.log('[ArchiveConfigPanel] 配置已保存')
  } catch (err) {
    console.warn('[ArchiveConfigPanel] 保存失败:', err)
  } finally {
    saving.value = false
  }
}

/** 恢复默认配置 */
function resetToDefault(): void {
  config.value = JSON.parse(JSON.stringify(DEFAULT_ARCHIVE_CONFIG))
  exclusionPatternsText.value = ''
  dirty.value = true
}

/** 监听配置变化标记 dirty */
watch(
  config,
  (newVal) => {
    if (newVal && !loading.value) dirty.value = true
  },
  { deep: true }
)

watch(exclusionPatternsText, () => {
  if (!loading.value) dirty.value = true
})

/** 组件挂载时加载配置 */
loadConfig()

/** 暴露方法供父组件调用 */
defineExpose({
  reload: loadConfig,
  isDirty: computed(() => dirty.value),
})
</script>

<style scoped>
.acp-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0;
}

.acp-loading {
  padding: 24px;
  text-align: center;
  color: var(--agent-text-secondary, #888);
  font-size: var(--font-size-sm);
}

.acp-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.2));
  border-radius: var(--agent-radius-sm, 8px);
}

.acp-section-label {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary, #666);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 2px;
}

.acp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-xs);
}

.acp-row-toggles {
  flex-wrap: wrap;
  gap: 12px;
}

.acp-label {
  color: var(--agent-text-secondary, #aaa);
  min-width: 120px;
  flex-shrink: 0;
}

.acp-input {
  flex: 1;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  color: var(--agent-text, #e0e0e0);
  padding: 4px 8px;
  border-radius: var(--agent-radius-sm, 8px);
  font-size: var(--font-size-xs);
  outline: none;
  font-family: var(--agent-font-mono, monospace);
  min-width: 0;
}
.acp-input:focus { border-color: var(--agent-primary, #6c5ce7); }

.acp-select {
  flex: 1;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  color: var(--agent-text, #e0e0e0);
  padding: 4px 8px;
  border-radius: var(--agent-radius-sm, 8px);
  font-size: var(--font-size-xs);
  outline: none;
  font-family: var(--agent-font, sans-serif);
  min-width: 0;
}
.acp-select:focus { border-color: var(--agent-primary, #6c5ce7); }

.acp-textarea {
  width: 100%;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  color: var(--agent-text, #e0e0e0);
  padding: 6px 8px;
  border-radius: var(--agent-radius-sm, 8px);
  font-size: var(--font-size-xs);
  outline: none;
  font-family: var(--agent-font-mono, monospace);
  resize: vertical;
  min-height: 60px;
}
.acp-textarea:focus { border-color: var(--agent-primary, #6c5ce7); }

.acp-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  color: var(--agent-text-secondary, #aaa);
  font-size: var(--font-size-xs);
}

.acp-toggle input[type="checkbox"] {
  cursor: pointer;
  accent-color: var(--agent-primary, #6c5ce7);
}

.acp-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.acp-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  background: transparent;
  color: var(--agent-text, #e0e0e0);
  border-radius: var(--agent-radius-sm, 8px);
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-family: var(--agent-font, sans-serif);
  flex: 1;
  justify-content: center;
}
.acp-btn:hover:not(:disabled) { background: var(--agent-accent-bg, rgba(108, 92, 231, 0.15)); }
.acp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.acp-btn.acp-primary {
  background: var(--agent-primary, #6c5ce7);
  border-color: var(--agent-primary, #6c5ce7);
  color: white;
}
.acp-btn.acp-primary:hover:not(:disabled) { opacity: 0.85; }

/* H3.4 专业参数悬浮提示 */
.acp-tooltip-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-left: 4px;
  border-radius: 50%;
  background: var(--agent-border, rgba(58, 58, 106, 0.4));
  color: var(--agent-text-tertiary, #888);
  font-size: 10px;
  cursor: help;
  vertical-align: middle;
  flex-shrink: 0;
}
</style>
