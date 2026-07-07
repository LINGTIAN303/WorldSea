<template>
  <Transition name="ws-menu">
    <div
      v-if="visible"
      class="archive-panel agent-panel"
      :style="panelStyle"
      @mousedown.left="onDragStart"
    >
      <!-- 拖拽 handle -->
      <div class="ap-drag-handle">
        <span class="ap-title"><WsIcon name="notebook" size="sm" /> 记忆库</span>
        <div class="ap-handle-actions">
          <button
            v-if="subPanel !== 'list'"
            class="ap-back-btn"
            @click="subPanel = 'list'"
            title="返回列表"
          ><WsIcon name="chevron-right" size="xs" /></button>
          <button class="ap-close-btn" @click="emit('close')">✕</button>
        </div>
      </div>

      <div class="ap-body" @mousedown.stop>
        <!-- 未初始化提示 -->
        <div v-if="!memoryArchive.isInitialized.value" class="ap-uninit">
          <WsIcon name="warning" size="sm" />
          <span>记忆库未初始化</span>
          <button class="ap-init-btn" @click="onManualInit">初始化</button>
        </div>

        <template v-else>
          <!-- 子面板切换 tabs（仅 list/search/stats/config/trash/merge 显示） -->
          <div v-if="subPanel === 'list' || subPanel === 'search' || subPanel === 'stats' || subPanel === 'config' || subPanel === 'trash' || subPanel === 'merge'" class="ap-tabs">
            <button
              class="ap-tab"
              :class="{ active: subPanel === 'list' }"
              @click="subPanel = 'list'"
            ><WsIcon name="list" size="xs" /> 列表</button>
            <button
              class="ap-tab"
              :class="{ active: subPanel === 'search' }"
              @click="subPanel = 'search'"
            ><WsIcon name="search" size="xs" /> 搜索</button>
            <button
              class="ap-tab"
              :class="{ active: subPanel === 'trash' }"
              @click="subPanel = 'trash'"
            ><WsIcon name="delete" size="xs" /> 回收站</button>
            <button
              class="ap-tab ap-tab-merge"
              :class="{ active: subPanel === 'merge' }"
              @click="subPanel = 'merge'"
            ><WsIcon name="link" size="xs" /> 待合并<span v-if="mergeGroups.length > 0" class="ap-tab-badge">{{ mergeGroups.length }}</span></button>
            <button
              class="ap-tab"
              :class="{ active: subPanel === 'stats' }"
              @click="subPanel = 'stats'"
            ><WsIcon name="dashboard" size="xs" /> 统计</button>
            <button
              class="ap-tab"
              :class="{ active: subPanel === 'config' }"
              @click="subPanel = 'config'"
            ><WsIcon name="settings" size="xs" /> 配置</button>
          </div>

          <!-- 列表视图 -->
          <div v-if="subPanel === 'list'" class="ap-list">
            <div v-if="hooks.length === 0" class="ap-empty">暂无记忆钩子</div>
            <div
              v-for="hook in hooks"
              :key="hook.id"
              class="ap-hook-card"
              :class="{ pinned: hook.pinned }"
              @click="openDetail(hook.id)"
            >
              <div class="ap-hook-header">
                <WsIcon
                  :name="hook.pinned ? 'star' : 'star-outline'"
                  size="xs"
                  :class="{ 'ap-pinned-icon': hook.pinned }"
                  @click.stop="togglePin(hook)"
                />
                <span class="ap-hook-date">{{ formatDate(hook.createdAt) }}</span>
                <span class="ap-hook-tokens">{{ hook.tokenCount.toLocaleString() }} tok</span>
                <span class="ap-hook-status" :class="`ap-status-${hook.status}`">{{ statusLabel(hook.status) }}</span>
              </div>
              <div class="ap-hook-summary">{{ hook.summary || '(无摘要)' }}</div>
              <div v-if="hook.keywords.length > 0 || hook.tags.length > 0" class="ap-hook-tags">
                <span v-for="kw in hook.keywords.slice(0, 3)" :key="kw" class="ap-kw">{{ kw }}</span>
                <span v-for="tag in hook.tags.slice(0, 3)" :key="tag" class="ap-tag">{{ tag }}</span>
              </div>
            </div>
          </div>

          <!-- 详情视图 -->
          <div v-else-if="subPanel === 'detail'" class="ap-detail">
            <div v-if="!selectedHook" class="ap-empty">未选择钩子</div>
            <template v-else>
              <div class="ap-detail-meta">
                <div class="ap-meta-row">
                  <span class="ap-meta-label">ID</span>
                  <span class="ap-meta-value ap-mono">{{ selectedHook.id }}</span>
                </div>
                <div class="ap-meta-row">
                  <span class="ap-meta-label">创建时间</span>
                  <span class="ap-meta-value">{{ formatDateTime(selectedHook.createdAt) }}</span>
                </div>
                <div class="ap-meta-row">
                  <span class="ap-meta-label">来源</span>
                  <span class="ap-meta-value">{{ sourceLabel(selectedHook.source) }}</span>
                </div>
                <div class="ap-meta-row">
                  <span class="ap-meta-label">摘要方式</span>
                  <span class="ap-meta-value">{{ selectedHook.summaryMethod }}</span>
                </div>
                <div class="ap-meta-row">
                  <span class="ap-meta-label">Tokens</span>
                  <span class="ap-meta-value">{{ selectedHook.tokenCount.toLocaleString() }}</span>
                </div>
                <div class="ap-meta-row">
                  <span class="ap-meta-label">消息范围</span>
                  <span class="ap-meta-value">{{ selectedHook.messageRange.start }} - {{ selectedHook.messageRange.end }}</span>
                </div>
                <div class="ap-meta-row">
                  <span class="ap-meta-label">访问次数</span>
                  <span class="ap-meta-value">{{ selectedHook.accessCount }} (主动 {{ selectedHook.activeAccessCount }})</span>
                </div>
                <div class="ap-meta-row">
                  <span class="ap-meta-label">最后访问</span>
                  <span class="ap-meta-value">{{ selectedHook.lastAccessedAt ? formatDateTime(selectedHook.lastAccessedAt) : '从未' }}</span>
                </div>
                <div class="ap-meta-row">
                  <span class="ap-meta-label">衰减评分</span>
                  <span class="ap-meta-value">{{ selectedHook.decayScore.toFixed(3) }}</span>
                </div>
                <div class="ap-meta-row">
                  <span class="ap-meta-label">重要性</span>
                  <span class="ap-meta-value">{{ selectedHook.importance.toFixed(2) }}</span>
                </div>
                <div class="ap-meta-row">
                  <span class="ap-meta-label">状态</span>
                  <span class="ap-meta-value ap-status" :class="`ap-status-${selectedHook.status}`">{{ statusLabel(selectedHook.status) }}</span>
                </div>
              </div>

              <!-- 摘要全文 -->
              <div class="ap-section">
                <div class="ap-section-label">摘要</div>
                <div class="ap-summary-full">{{ selectedHook.summary || '(无摘要)' }}</div>
              </div>

              <!-- 主题块列表 -->
              <div class="ap-section">
                <div class="ap-section-label">主题块 ({{ selectedHook.chunkTitles.length }})</div>
                <div class="ap-chunks">
                  <div
                    v-for="chunk in selectedHook.chunkTitles"
                    :key="chunk.chunkId"
                    class="ap-chunk-item"
                    @click="openChunkViewer(chunk.chunkId)"
                  >
                    <WsIcon name="folder-open" size="xs" />
                    <div class="ap-chunk-info">
                      <div class="ap-chunk-title">{{ chunk.title }}</div>
                      <div class="ap-chunk-meta">
                        <span :class="`ap-type-${chunk.outputType}`">{{ chunk.outputType }}</span>
                        <span>{{ chunk.tokenCount.toLocaleString() }} tok</span>
                      </div>
                      <div class="ap-chunk-anchor">{{ chunk.userMessageAnchor }}</div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 关键词 -->
              <div v-if="selectedHook.keywords.length > 0" class="ap-section">
                <div class="ap-section-label">关键词</div>
                <div class="ap-tags-wrap">
                  <span v-for="kw in selectedHook.keywords" :key="kw" class="ap-kw">{{ kw }}</span>
                </div>
              </div>

              <!-- 标签（可编辑） -->
              <div class="ap-section">
                <div class="ap-section-label">标签</div>
                <div class="ap-tags-wrap">
                  <span v-for="tag in selectedHook.tags" :key="tag" class="ap-tag ap-tag-removable">
                    {{ tag }}
                    <button class="ap-tag-remove" @click.stop="removeTag(tag)">✕</button>
                  </span>
                  <input
                    v-model="newTagInput"
                    class="ap-tag-input"
                    placeholder="+ 添加标签"
                    @keydown.enter="addTag"
                  />
                </div>
              </div>

              <!-- 操作按钮 -->
              <div class="ap-detail-actions">
                <button class="ap-action-btn" @click="togglePin(selectedHook)">
                  <WsIcon :name="selectedHook.pinned ? 'star' : 'star-outline'" size="xs" />
                  {{ selectedHook.pinned ? '取消置顶' : '置顶' }}
                </button>
                <button class="ap-action-btn ap-danger" @click="confirmDelete">
                  <WsIcon name="delete" size="xs" /> 删除
                </button>
              </div>
            </template>
          </div>

          <!-- 搜索视图 -->
          <div v-else-if="subPanel === 'search'" class="ap-search">
            <div class="ap-search-bar">
              <input
                v-model="searchQuery"
                class="ap-search-input"
                placeholder="输入关键词搜索..."
                @keydown.enter="doSearch"
              />
              <select v-model="searchMode" class="ap-search-mode">
                <option value="keyword">关键词</option>
                <option value="semantic">语义</option>
                <option value="hybrid">混合</option>
                <option value="list">列表</option>
              </select>
              <button class="ap-search-btn" @click="doSearch"><WsIcon name="search" size="xs" /></button>
            </div>
            <!-- H3.4: 搜索模式说明 -->
            <div class="ap-search-hint">
              <span v-if="searchMode === 'keyword'">关键词模式：按关键词精确匹配，适合搜索特定实体/概念</span>
              <span v-else-if="searchMode === 'semantic'">语义模式：按语义相似度匹配，需要 Embedding 模型支持</span>
              <span v-else-if="searchMode === 'hybrid'">混合模式：结合关键词和语义，效果最佳</span>
              <span v-else>列表模式：按时间倒序列出所有钩子</span>
            </div>
            <div v-if="searchLoading" class="ap-empty">搜索中...</div>
            <div v-else-if="searchResults.length === 0 && searchDone" class="ap-empty">无匹配结果</div>
            <div v-else class="ap-search-results">
              <div
                v-for="result in searchResults"
                :key="result.hook.id"
                class="ap-search-item"
                @click="openDetail(result.hook.id)"
              >
                <div class="ap-search-header">
                  <!-- H4.2: score 可视化条 -->
                  <div class="ap-search-score-bar">
                    <div class="ap-search-score-fill" :style="{ width: Math.min(100, result.score * 10) + '%' }"></div>
                    <span class="ap-search-score">{{ result.score.toFixed(2) }}</span>
                  </div>
                  <span class="ap-hook-date">{{ formatDate(result.hook.createdAt) }}</span>
                </div>
                <div class="ap-hook-summary">{{ result.hook.summary || '(无摘要)' }}</div>
                <!-- H4.2: 匹配字段详细展示 -->
                <div v-if="result.matchedFields.length > 0" class="ap-matched">
                  <span
                    v-for="field in result.matchedFields"
                    :key="field"
                    class="ap-matched-field"
                    :class="`ap-matched-${field.split(':')[0]}`"
                  >{{ field }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 统计视图 -->
          <div v-else-if="subPanel === 'stats'" class="ap-stats">
            <div class="ap-stat-item">
              <div class="ap-stat-label">钩子总数</div>
              <div class="ap-stat-value">{{ stats.totalHooks }}</div>
            </div>
            <div class="ap-stat-item">
              <div class="ap-stat-label">总 Tokens</div>
              <div class="ap-stat-value">{{ stats.totalTokens.toLocaleString() }}</div>
            </div>
            <div class="ap-stat-item">
              <div class="ap-stat-label">置顶钩子</div>
              <div class="ap-stat-value">{{ stats.pinnedCount }}</div>
            </div>
            <div class="ap-stat-item">
              <div class="ap-stat-label">活跃钩子</div>
              <div class="ap-stat-value">{{ stats.activeCount }}</div>
            </div>
            <div class="ap-stat-item">
              <div class="ap-stat-label">淘汰钩子</div>
              <div class="ap-stat-value">{{ stats.deprecatedCount }}</div>
            </div>
            <div class="ap-stat-item">
              <div class="ap-stat-label">平均重要性</div>
              <div class="ap-stat-value">{{ stats.avgImportance.toFixed(2) }}</div>
            </div>
            <div class="ap-stat-item">
              <div class="ap-stat-label">平均衰减</div>
              <div class="ap-stat-value">{{ stats.avgDecay.toFixed(3) }}</div>
            </div>
            <div class="ap-stat-item">
              <div class="ap-stat-label">LLM 摘要数</div>
              <div class="ap-stat-value">{{ stats.llmSummaryCount }}</div>
            </div>
            <!-- H3.5 新增统计项 -->
            <div class="ap-stat-item ap-stat-highlight">
              <div class="ap-stat-label">总访问次数</div>
              <div class="ap-stat-value">{{ stats.totalAccessCount }}</div>
            </div>
            <div class="ap-stat-item ap-stat-highlight">
              <div class="ap-stat-label">主动检索次数</div>
              <div class="ap-stat-value">{{ stats.totalActiveAccess }}</div>
            </div>
            <div v-if="metaInfo" class="ap-stat-item ap-stat-highlight">
              <div class="ap-stat-label">存储占用</div>
              <div class="ap-stat-value">{{ formatBytes(metaInfo.totalStorageBytes) }}</div>
            </div>
            <div v-if="stats.orphanCount > 0" class="ap-stat-item ap-stat-warn">
              <div class="ap-stat-label">孤儿钩子</div>
              <div class="ap-stat-value">{{ stats.orphanCount }}</div>
            </div>
            <div v-if="stats.trashedCount > 0" class="ap-stat-item ap-stat-warn">
              <div class="ap-stat-label">回收站钩子</div>
              <div class="ap-stat-value">{{ stats.trashedCount }}</div>
            </div>
            <div v-if="stats.pendingMergeCount > 0" class="ap-stat-item ap-stat-warn">
              <div class="ap-stat-label">待合并钩子</div>
              <div class="ap-stat-value">{{ stats.pendingMergeCount }}</div>
            </div>
          </div>

          <!-- H3.1+H3.2 回收站视图 -->
          <div v-else-if="subPanel === 'trash'" class="ap-trash">
            <div class="ap-trash-header">
              <span class="ap-trash-count">回收站 ({{ trashedHooks.length }})</span>
              <button
                v-if="trashedHooks.length > 0"
                class="ap-trash-empty-btn"
                @click="confirmEmptyTrash"
                :class="{ confirm: emptyTrashConfirm }"
              >
                {{ emptyTrashConfirm ? '确认清空' : '清空回收站' }}
              </button>
            </div>
            <div v-if="trashLoading" class="ap-empty">加载中...</div>
            <div v-else-if="trashedHooks.length === 0" class="ap-empty">回收站为空</div>
            <div v-else class="ap-trash-list">
              <div
                v-for="hook in trashedHooks"
                :key="hook.id"
                class="ap-trash-item"
              >
                <div class="ap-trash-info">
                  <div class="ap-trash-summary">{{ hook.summary || '(无摘要)' }}</div>
                  <div class="ap-trash-meta">
                    <span>{{ formatDate(hook.createdAt) }}</span>
                    <span>{{ hook.tokenCount.toLocaleString() }} tok</span>
                    <span v-if="hook.trashedAt">删除于 {{ formatDateTime(hook.trashedAt) }}</span>
                  </div>
                </div>
                <div class="ap-trash-actions">
                  <button class="ap-trash-restore" @click="restoreFromTrash(hook.id)" title="恢复">
                    <WsIcon name="undo" size="xs" /> 恢复
                  </button>
                  <button class="ap-trash-perm-delete" @click="permanentDelete(hook.id)" title="永久删除">
                    <WsIcon name="close" size="xs" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- H5.3 待合并视图 -->
          <div v-else-if="subPanel === 'merge'" class="ap-merge">
            <div class="ap-merge-header">
              <span class="ap-merge-count">待合并 ({{ mergeGroups.length }} 组)</span>
              <div v-if="mergeGroups.length > 0" class="ap-merge-actions">
                <button class="ap-merge-confirm-all" @click="confirmAllMerges" :disabled="mergeLoading">
                  全部确认合并
                </button>
              </div>
            </div>
            <div v-if="mergeLoading" class="ap-empty">加载中...</div>
            <div v-else-if="mergeGroups.length === 0" class="ap-empty">暂无待合并项</div>
            <div v-else class="ap-merge-list">
              <div
                v-for="(group, idx) in mergeGroups"
                :key="group.mainHook.id"
                class="ap-merge-group"
              >
                <div class="ap-merge-group-header">
                  <span class="ap-merge-group-title">组 {{ idx + 1 }}</span>
                  <span class="ap-merge-group-count">{{ group.pendingHooks.length }} 项待合并</span>
                  <button class="ap-merge-confirm-btn" @click="confirmOneMerge(group.mainHook.id)" :disabled="mergeLoading">
                    确认合并
                  </button>
                </div>
                <div class="ap-merge-main">
                  <div class="ap-merge-label">主钩子（保留）</div>
                  <div class="ap-merge-hook-card ap-merge-main-card">
                    <div class="ap-merge-hook-summary">{{ group.mainHook.summary || '(无摘要)' }}</div>
                    <div class="ap-merge-hook-meta">
                      <span>{{ formatDate(group.mainHook.createdAt) }}</span>
                      <span>{{ group.mainHook.tokenCount.toLocaleString() }} tok</span>
                      <span>衰减 {{ group.mainHook.decayScore.toFixed(2) }}</span>
                    </div>
                    <div v-if="group.mainHook.keywords.length > 0" class="ap-merge-keywords">
                      <span v-for="kw in group.mainHook.keywords.slice(0, 5)" :key="kw" class="ap-kw">{{ kw }}</span>
                    </div>
                  </div>
                </div>
                <div class="ap-merge-pending">
                  <div class="ap-merge-label">待合并钩子（将标记为已淘汰）</div>
                  <div
                    v-for="ph in group.pendingHooks"
                    :key="ph.id"
                    class="ap-merge-hook-card ap-merge-pending-card"
                  >
                    <div class="ap-merge-hook-summary">{{ ph.summary || '(无摘要)' }}</div>
                    <div class="ap-merge-hook-meta">
                      <span>{{ formatDate(ph.createdAt) }}</span>
                      <span>{{ ph.tokenCount.toLocaleString() }} tok</span>
                      <span>衰减 {{ ph.decayScore.toFixed(2) }}</span>
                    </div>
                    <div v-if="ph.keywords.length > 0" class="ap-merge-keywords">
                      <span v-for="kw in ph.keywords.slice(0, 5)" :key="kw" class="ap-kw">{{ kw }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 配置视图（P3-4-3 新增） -->
          <div v-else-if="subPanel === 'config'" class="ap-config">
            <ArchiveConfigPanel ref="configPanel" @saved="onConfigSaved" />

            <!-- 周期任务操作区（P4 新增） -->
            <div class="acp-section ap-scheduler-section">
              <div class="acp-section-label">周期任务操作</div>
              <div v-if="metaInfo" class="ap-meta-info">
                <div class="ap-meta-row">
                  <span class="ap-meta-label">上次日任务</span>
                  <span class="ap-meta-value">{{ formatTime(metaInfo.lastDailyRun) }}</span>
                </div>
                <div class="ap-meta-row">
                  <span class="ap-meta-label">上次周任务</span>
                  <span class="ap-meta-value">{{ formatTime(metaInfo.lastWeeklyRun) }}</span>
                </div>
                <div class="ap-meta-row">
                  <span class="ap-meta-label">上次月任务</span>
                  <span class="ap-meta-value">{{ formatTime(metaInfo.lastMonthlyRun) }}</span>
                </div>
                <div class="ap-meta-row">
                  <span class="ap-meta-label">存储占用</span>
                  <span class="ap-meta-value">{{ formatBytes(metaInfo.totalStorageBytes) }}</span>
                </div>
                <div v-if="metaInfo.failedDeletions.length > 0" class="ap-meta-row">
                  <span class="ap-meta-label">失败删除队列</span>
                  <span class="ap-meta-value ap-meta-warn">{{ metaInfo.failedDeletions.length }} 项</span>
                </div>
              </div>
              <div class="ap-scheduler-actions">
                <button class="ap-scheduler-btn" @click="runDailyNow" :disabled="schedulerRunning">
                  <WsIcon name="refresh" size="xs" /> 日任务
                </button>
                <button class="ap-scheduler-btn" @click="runWeeklyNow" :disabled="schedulerRunning">
                  <WsIcon name="refresh" size="xs" /> 周任务
                </button>
                <button class="ap-scheduler-btn" @click="runMonthlyNow" :disabled="schedulerRunning">
                  <WsIcon name="refresh" size="xs" /> 月任务
                </button>
                <button
                  v-if="schedulerRunning"
                  class="ap-scheduler-btn ap-scheduler-stop"
                  @click="interruptScheduler"
                >
                  <WsIcon name="close" size="xs" /> 中断
                </button>
              </div>
              <div v-if="lastTaskLog" class="ap-task-log" :class="`ap-task-log-${lastTaskLog.status}`">
                {{ lastTaskLog.taskName }}任务: {{ lastTaskLog.status === 'success' ? '成功' : lastTaskLog.status === 'failed' ? '失败' : '部分完成' }}
                <span v-if="lastTaskLog.processedCount">（处理 {{ lastTaskLog.processedCount }} 项）</span>
                <span v-if="lastTaskLog.error"> - {{ lastTaskLog.error }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- 底部操作栏 -->
      <div v-if="memoryArchive.isInitialized.value" class="ap-footer" @mousedown.stop>
        <button class="ap-footer-btn" @click="refresh" :disabled="refreshing">
          <WsIcon name="refresh" size="xs" /> 刷新
        </button>
        <button class="ap-footer-btn ap-primary" @click="manualArchive" :disabled="archiving">
          <WsIcon name="save" size="xs" /> {{ archiving ? '归档中...' : '手动归档' }}
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
/**
 * ArchivePanel - 记忆库管理面板
 *
 * P3-3-3 新增：记忆库管理 UI，提供钩子列表/详情/搜索/统计 4 个子视图。
 *
 * 功能（设计文档 5.6 第一期）：
 * - 钩子列表（日期、tokens、状态、摘要预览、pinned 标记）
 * - 钩子详情（chunkTitles、accessCount、decayScore、keywords、tags）
 * - 片段加载查看（ChunkViewer）
 * - 搜索功能（keyword/semantic/hybrid/list 4 种模式）
 * - 统计信息（钩子数、总 tokens、置顶/活跃/淘汰数、平均重要性/衰减）
 * - 手动归档按钮
 * - 标签编辑、置顶、删除操作
 */
import { ref, computed, watch } from 'vue'
import WsIcon from '../ui/WsIcon.vue'
import { usePanelDrag } from '../agent/composables/usePanelDrag'
import { useMemoryArchive } from '../memory-archive'
import { toastError } from '@/composables/useToast'
import ArchiveConfigPanel from './ArchiveConfigPanel.vue'
import type { Hook, RecallMode, RecallResult, ArchiveMeta, TaskLogEntry } from '@worldsmith/memory-archive'

const props = defineProps<{
  visible: boolean
  position: { x: number; y: number }
  dragged: boolean
}>()

const emit = defineEmits<{
  close: []
  dragstart: [e: MouseEvent]
  'open-chunk': [hookId: string, chunkId: string]
}>()

const memoryArchive = useMemoryArchive()

// ===== 子面板状态 =====
type SubPanel = 'list' | 'detail' | 'search' | 'stats' | 'config' | 'trash' | 'merge'
const subPanel = ref<SubPanel>('list')

// ===== 配置面板 ref（P3-4-3 新增）=====
const configPanel = ref<InstanceType<typeof ArchiveConfigPanel> | null>(null)

function onConfigSaved(): void {
  console.log('[ArchivePanel] 配置已保存，刷新列表')
  refresh()
}

// 切换到 config 子视图时重新加载配置（确保显示最新值）
// H3.1: 切换到 trash 子视图时加载回收站数据
// H5.3: 切换到 merge 子视图时加载待合并组
watch(subPanel, (newVal) => {
  if (newVal === 'config') {
    configPanel.value?.reload()
    loadMetaInfo()
  } else if (newVal === 'trash') {
    loadTrashedHooks()
  } else if (newVal === 'merge') {
    loadMergeGroups()
  }
})

// ===== 钩子列表 =====
const hooks = ref<Hook[]>([])
const refreshing = ref(false)

async function refresh(): Promise<void> {
  if (refreshing.value) return
  refreshing.value = true
  try {
    hooks.value = memoryArchive.getAllHooks()
  } catch (err) {
    console.warn('[ArchivePanel] 刷新失败:', err)
  } finally {
    refreshing.value = false
  }
}

// ===== 详情视图 =====
const selectedHook = ref<Hook | null>(null)
const newTagInput = ref('')

function openDetail(hookId: string): void {
  const hook = hooks.value.find((h) => h.id === hookId)
  if (hook) {
    selectedHook.value = hook
    subPanel.value = 'detail'
    newTagInput.value = ''
  }
}

async function togglePin(hook: Hook): Promise<void> {
  try {
    await memoryArchive.pinHook(hook.id, !hook.pinned)
    hook.pinned = !hook.pinned
    console.log('[ArchivePanel] 置顶状态已更新:', hook.id, hook.pinned)
  } catch (err) {
    console.warn('[ArchivePanel] 置顶失败:', err)
  }
}

async function addTag(): Promise<void> {
  if (!selectedHook.value || !newTagInput.value.trim()) return
  const tag = newTagInput.value.trim()
  if (selectedHook.value.tags.includes(tag)) {
    newTagInput.value = ''
    return
  }
  const newTags = [...selectedHook.value.tags, tag]
  try {
    await memoryArchive.tagHook(selectedHook.value.id, newTags)
    selectedHook.value.tags = newTags
    newTagInput.value = ''
  } catch (err) {
    console.warn('[ArchivePanel] 添加标签失败:', err)
  }
}

async function removeTag(tag: string): Promise<void> {
  if (!selectedHook.value) return
  const newTags = selectedHook.value.tags.filter((t) => t !== tag)
  try {
    await memoryArchive.tagHook(selectedHook.value.id, newTags)
    selectedHook.value.tags = newTags
  } catch (err) {
    console.warn('[ArchivePanel] 移除标签失败:', err)
  }
}

// ===== H3.1+H3.2 回收站管理 =====
const trashedHooks = ref<Hook[]>([])
const trashLoading = ref(false)
const emptyTrashConfirm = ref(false)

async function loadTrashedHooks(): Promise<void> {
  trashLoading.value = true
  try {
    trashedHooks.value = await memoryArchive.listTrashedHooks()
  } catch (err) {
    console.warn('[ArchivePanel] 加载回收站失败:', err)
    trashedHooks.value = []
  } finally {
    trashLoading.value = false
  }
}

async function restoreFromTrash(hookId: string): Promise<void> {
  try {
    await memoryArchive.restoreHook(hookId)
    trashedHooks.value = trashedHooks.value.filter(h => h.id !== hookId)
    await refresh()
    console.log('[ArchivePanel] 钩子已从回收站恢复:', hookId)
  } catch (err) {
    console.warn('[ArchivePanel] 恢复失败:', err)
    toastError('恢复钩子失败')
  }
}

async function permanentDelete(hookId: string): Promise<void> {
  try {
    await memoryArchive.deleteHook(hookId, true) // permanent=true
    trashedHooks.value = trashedHooks.value.filter(h => h.id !== hookId)
    console.log('[ArchivePanel] 钩子已永久删除:', hookId)
  } catch (err) {
    console.warn('[ArchivePanel] 永久删除失败:', err)
    toastError('永久删除失败')
  }
}

function confirmEmptyTrash(): void {
  if (emptyTrashConfirm.value) {
    doEmptyTrash()
  } else {
    emptyTrashConfirm.value = true
    setTimeout(() => { emptyTrashConfirm.value = false }, 3000)
  }
}

async function doEmptyTrash(): Promise<void> {
  try {
    const result = await memoryArchive.emptyTrash()
    trashedHooks.value = []
    emptyTrashConfirm.value = false
    console.log(`[ArchivePanel] 回收站已清空: ${result.hooks} 钩子, ${result.files} 文件`)
  } catch (err) {
    console.warn('[ArchivePanel] 清空回收站失败:', err)
    toastError('清空回收站失败')
  }
}

// ===== H5.3 待合并管理 =====
interface MergeGroup {
  mainHook: Hook
  pendingHooks: Hook[]
}
const mergeGroups = ref<MergeGroup[]>([])
const mergeLoading = ref(false)

/** 加载待合并组 */
async function loadMergeGroups(): Promise<void> {
  mergeLoading.value = true
  try {
    mergeGroups.value = memoryArchive.getPendingMergeGroups()
  } catch (err) {
    console.warn('[ArchivePanel] 加载待合并组失败:', err)
    mergeGroups.value = []
  } finally {
    mergeLoading.value = false
  }
}

/** 确认单组合并 */
async function confirmOneMerge(_mainHookId: string): Promise<void> {
  mergeLoading.value = true
  try {
    // 由于 confirmMerge 会合并所有 pending_merge，这里先记录当前组数
    const beforeCount = mergeGroups.value.length
    const mergedCount = await memoryArchive.confirmMerge()
    await refresh()
    await loadMergeGroups()
    console.log(`[ArchivePanel] 合并完成: ${mergedCount} 组（之前 ${beforeCount} 组）`)
  } catch (err) {
    console.warn('[ArchivePanel] 确认合并失败:', err)
    toastError('确认合并失败')
  } finally {
    mergeLoading.value = false
  }
}

/** 确认全部合并 */
async function confirmAllMerges(): Promise<void> {
  mergeLoading.value = true
  try {
    const mergedCount = await memoryArchive.confirmMerge()
    await refresh()
    await loadMergeGroups()
    console.log(`[ArchivePanel] 全部合并完成: ${mergedCount} 组`)
  } catch (err) {
    console.warn('[ArchivePanel] 全部合并失败:', err)
    toastError('全部合并失败')
  } finally {
    mergeLoading.value = false
  }
}

const deleteConfirmId = ref<string | null>(null)

function confirmDelete(): void {
  if (!selectedHook.value) return
  // 二次点击确认
  if (deleteConfirmId.value === selectedHook.value.id) {
    doDelete()
  } else {
    deleteConfirmId.value = selectedHook.value.id
    console.log('[ArchivePanel] 再次点击确认删除')
    setTimeout(() => {
      if (deleteConfirmId.value === selectedHook.value?.id) {
        deleteConfirmId.value = null
      }
    }, 3000)
  }
}

async function doDelete(): Promise<void> {
  if (!selectedHook.value) return
  const hookId = selectedHook.value.id
  try {
    await memoryArchive.deleteHook(hookId)
    hooks.value = hooks.value.filter((h) => h.id !== hookId)
    selectedHook.value = null
    deleteConfirmId.value = null
    subPanel.value = 'list'
    console.log('[ArchivePanel] 钩子已删除:', hookId)
  } catch (err) {
    console.warn('[ArchivePanel] 删除失败:', err)
    toastError('删除钩子失败')
  }
}

function openChunkViewer(chunkId: string): void {
  if (!selectedHook.value) return
  emit('open-chunk', selectedHook.value.id, chunkId)
}

// ===== 搜索视图 =====
const searchQuery = ref('')
const searchMode = ref<RecallMode>('hybrid')
const searchResults = ref<RecallResult[]>([])
const searchLoading = ref(false)
const searchDone = ref(false)

async function doSearch(): Promise<void> {
  if (searchLoading.value) return
  searchLoading.value = true
  searchDone.value = false
  try {
    const results = await memoryArchive.recall({
      query: searchQuery.value,
      mode: searchMode.value,
      topK: 20,
    })
    searchResults.value = results
  } catch (err) {
    console.warn('[ArchivePanel] 搜索失败:', err)
    searchResults.value = []
    toastError('搜索记忆失败')
  } finally {
    searchLoading.value = false
    searchDone.value = true
  }
}

// ===== 统计视图 =====
const stats = computed(() => {
  const all = hooks.value
  const totalHooks = all.length
  const totalTokens = all.reduce((sum, h) => sum + h.tokenCount, 0)
  const pinnedCount = all.filter((h) => h.pinned).length
  const activeCount = all.filter((h) => h.status === 'active').length
  const deprecatedCount = all.filter((h) => h.status === 'deprecated').length
  const avgImportance = totalHooks > 0 ? all.reduce((sum, h) => sum + h.importance, 0) / totalHooks : 0
  const avgDecay = totalHooks > 0 ? all.reduce((sum, h) => sum + h.decayScore, 0) / totalHooks : 0
  const llmSummaryCount = all.filter((h) => h.summaryMethod === 'llm').length
  // H3.5 新增统计项
  const totalAccessCount = all.reduce((sum, h) => sum + h.accessCount, 0) // 总访问次数（含检索）
  const totalActiveAccess = all.reduce((sum, h) => sum + h.activeAccessCount, 0) // 主动检索次数
  const orphanCount = all.filter((h) => h.status === 'orphan').length
  const trashedCount = all.filter((h) => h.status === 'trashed').length
  const pendingMergeCount = all.filter((h) => h.status === 'pending_merge').length
  return {
    totalHooks,
    totalTokens,
    pinnedCount,
    activeCount,
    deprecatedCount,
    avgImportance,
    avgDecay,
    llmSummaryCount,
    // H3.5 新增
    totalAccessCount,
    totalActiveAccess,
    orphanCount,
    trashedCount,
    pendingMergeCount,
  }
})

// ===== 手动归档 =====
const archiving = ref(false)

async function manualArchive(): Promise<void> {
  if (archiving.value) return
  archiving.value = true
  try {
    const result = await memoryArchive.archive({ source: 'manual' })
    console.log('[ArchivePanel] 手动归档完成:', result)
    await refresh()
  } catch (err) {
    console.warn('[ArchivePanel] 手动归档失败:', err)
    toastError('手动归档失败')
  } finally {
    archiving.value = false
  }
}

// ===== 周期任务（P4 新增）=====
const metaInfo = ref<ArchiveMeta | null>(null)
const schedulerRunning = ref(false)
const lastTaskLog = ref<TaskLogEntry | null>(null)

/** 加载记忆库元数据 */
async function loadMetaInfo(): Promise<void> {
  try {
    metaInfo.value = await memoryArchive.getMeta()
  } catch (err) {
    console.warn('[ArchivePanel] 加载元数据失败:', err)
    metaInfo.value = null
  }
}

/** 手动触发日任务 */
async function runDailyNow(): Promise<void> {
  if (schedulerRunning.value) return
  schedulerRunning.value = true
  lastTaskLog.value = null
  try {
    const log = await memoryArchive.runDailyNow()
    lastTaskLog.value = log
    await loadMetaInfo()
    await refresh()
    console.log('[ArchivePanel] 日任务完成:', log)
  } catch (err) {
    console.warn('[ArchivePanel] 日任务失败:', err)
    lastTaskLog.value = {
      taskName: 'daily',
      startTime: Date.now(),
      endTime: Date.now(),
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    schedulerRunning.value = false
  }
}

/** 手动触发周任务 */
async function runWeeklyNow(): Promise<void> {
  if (schedulerRunning.value) return
  schedulerRunning.value = true
  lastTaskLog.value = null
  try {
    const log = await memoryArchive.runWeeklyNow()
    lastTaskLog.value = log
    await loadMetaInfo()
    await refresh()
    console.log('[ArchivePanel] 周任务完成:', log)
  } catch (err) {
    console.warn('[ArchivePanel] 周任务失败:', err)
    lastTaskLog.value = {
      taskName: 'weekly',
      startTime: Date.now(),
      endTime: Date.now(),
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    schedulerRunning.value = false
  }
}

/** 手动触发月任务 */
async function runMonthlyNow(): Promise<void> {
  if (schedulerRunning.value) return
  schedulerRunning.value = true
  lastTaskLog.value = null
  try {
    const log = await memoryArchive.runMonthlyNow()
    lastTaskLog.value = log
    await loadMetaInfo()
    await refresh()
    console.log('[ArchivePanel] 月任务完成:', log)
  } catch (err) {
    console.warn('[ArchivePanel] 月任务失败:', err)
    lastTaskLog.value = {
      taskName: 'monthly',
      startTime: Date.now(),
      endTime: Date.now(),
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    schedulerRunning.value = false
  }
}

/** 中断当前周期任务 */
function interruptScheduler(): void {
  try {
    memoryArchive.interruptScheduler()
    console.log('[ArchivePanel] 已请求中断周期任务')
  } catch (err) {
    console.warn('[ArchivePanel] 中断失败:', err)
  }
}

/** 格式化时间戳（未运行时显示"未运行"） */
function formatTime(ts: number): string {
  if (!ts) return '未运行'
  return new Date(ts).toLocaleString('zh-CN', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 格式化字节数 */
function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let val = bytes
  let unitIdx = 0
  while (val >= 1024 && unitIdx < units.length - 1) {
    val /= 1024
    unitIdx++
  }
  return `${val.toFixed(val >= 100 ? 0 : 1)} ${units[unitIdx]}`
}

// ===== 手动初始化 =====
async function onManualInit(): Promise<void> {
  try {
    await memoryArchive.init()
    await refresh()
  } catch (err) {
    console.warn('[ArchivePanel] 初始化失败:', err)
    toastError('记忆库初始化失败')
  }
}

// ===== 拖拽 =====
const posX = computed({
  get: () => props.position.x,
  set: () => {},
})
const posY = computed({
  get: () => props.position.y,
  set: () => {},
})

const { onDragStart } = usePanelDrag({
  x: posX,
  y: posY,
  onDragEnd: () => {},
  excludeSelector: '.ap-body,.ap-close-btn,.ap-back-btn',
})

const panelStyle = computed(() => {
  if (props.dragged) {
    return { left: `${props.position.x}px`, top: `${props.position.y}px` }
  }
  return { left: `${props.position.x}px`, bottom: `${props.position.y}px` }
})

// ===== 辅助函数 =====

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  })
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    active: '活跃',
    deprecated: '淘汰',
    pending_delete: '待删除',
    orphan: '孤儿',
    trashed: '已回收',
    pending_merge: '待合并',
  }
  return map[status] || status
}

function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    threshold: '阈值触发',
    session_end: '会话结束',
    manual: '手动',
  }
  return map[source] || source
}

// ===== 可见性变化时刷新 =====
watch(
  () => props.visible,
  (v) => {
    if (v && memoryArchive.isInitialized.value) {
      refresh()
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.archive-panel {
  position: fixed;
  width: 420px;
  max-width: 90vw;
  max-height: 75vh;
  background: var(--agent-bg, rgba(26, 26, 46, 0.92));
  backdrop-filter: blur(var(--agent-blur, 16px));
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  border-radius: var(--agent-radius, 14px);
  box-shadow: var(--shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.5));
  z-index: 10001;
  overflow: hidden;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
}

.ap-drag-handle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--agent-border, rgba(58, 58, 106, 0.3));
  cursor: grab;
  user-select: none;
}
.ap-drag-handle:active { cursor: grabbing }

.ap-title {
  font-size: var(--font-size-sm);
  color: var(--agent-text, #e0e0e0);
  font-family: var(--agent-font, sans-serif);
  display: flex;
  align-items: center;
  gap: 6px;
}

.ap-handle-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}

.ap-back-btn, .ap-close-btn {
  background: none;
  border: none;
  color: var(--agent-text-secondary, #888);
  cursor: pointer;
  font-size: var(--font-size-base);
  padding: 2px 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
}
.ap-back-btn:hover, .ap-close-btn:hover {
  background: var(--agent-accent-bg, rgba(108, 92, 231, 0.15));
  color: var(--agent-text, #e0e0e0);
}
.ap-back-btn { transform: rotate(180deg); }

.ap-body {
  padding: 10px 12px;
  overflow-y: auto;
  flex: 1;
}

.ap-uninit {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 32px 16px;
  color: var(--agent-text-secondary, #888);
  font-size: var(--font-size-sm);
}

.ap-init-btn {
  padding: 6px 16px;
  border: 1px solid var(--agent-primary, #6c5ce7);
  background: transparent;
  color: var(--agent-primary, #6c5ce7);
  border-radius: var(--agent-radius-sm, 8px);
  cursor: pointer;
  font-size: var(--font-size-sm);
}
.ap-init-btn:hover { background: var(--agent-accent-bg, rgba(108, 92, 231, 0.15)); }

.ap-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--agent-border, rgba(58, 58, 106, 0.3));
  padding-bottom: 6px;
}

.ap-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: var(--agent-text-secondary, #888);
  cursor: pointer;
  font-size: var(--font-size-xs);
  border-radius: var(--agent-radius-sm, 8px);
  font-family: var(--agent-font, sans-serif);
}
.ap-tab:hover { background: var(--agent-accent-bg, rgba(108, 92, 231, 0.1)); }
.ap-tab.active {
  background: var(--agent-accent-bg, rgba(108, 92, 231, 0.2));
  color: var(--agent-text, #e0e0e0);
}

.ap-empty {
  padding: 24px;
  text-align: center;
  color: var(--agent-text-secondary, #888);
  font-size: var(--font-size-sm);
}

/* 列表视图 */
.ap-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ap-hook-card {
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.2));
  border-radius: var(--agent-radius-sm, 8px);
  cursor: pointer;
  transition: border-color 0.15s;
}
.ap-hook-card:hover {
  border-color: var(--agent-primary, #6c5ce7);
}
.ap-hook-card.pinned {
  border-color: var(--agent-warning, #fdcb6e);
  background: rgba(253, 203, 110, 0.05);
}

.ap-hook-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  margin-bottom: 4px;
}

.ap-pinned-icon { color: var(--agent-warning, #fdcb6e); }

.ap-hook-date {
  color: var(--agent-text-tertiary, #666);
}

.ap-hook-tokens {
  color: var(--agent-text-secondary, #aaa);
  margin-left: auto;
}

.ap-hook-status {
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 10px;
}
.ap-status-active { background: rgba(100, 200, 100, 0.2); color: #6c8; }
.ap-status-deprecated { background: rgba(200, 100, 100, 0.2); color: #c68; }
.ap-status-pending_delete { background: rgba(200, 100, 100, 0.3); color: #f88; }

.ap-hook-summary {
  font-size: var(--font-size-xs);
  color: var(--agent-text-secondary, #aaa);
  line-height: 1.4;
  max-height: 60px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.ap-hook-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.ap-kw, .ap-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
}
.ap-kw { background: rgba(108, 92, 231, 0.2); color: var(--agent-text, #e0e0e0); }
.ap-tag { background: rgba(100, 149, 237, 0.2); color: #6cf; }

/* 详情视图 */
.ap-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ap-detail-meta {
  background: var(--agent-accent-bg, rgba(108, 92, 231, 0.08));
  border-radius: var(--agent-radius-sm, 8px);
  padding: 10px 12px;
}

.ap-meta-row {
  display: flex;
  gap: 8px;
  padding: 2px 0;
  font-size: var(--font-size-xs);
}

.ap-meta-label {
  color: var(--agent-text-tertiary, #666);
  min-width: 72px;
}

.ap-meta-value {
  color: var(--agent-text, #e0e0e0);
  flex: 1;
  word-break: break-all;
}

.ap-mono { font-family: var(--agent-font-mono, monospace); font-size: 11px; }

.ap-status {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
}

.ap-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ap-section-label {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary, #666);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.ap-summary-full {
  font-size: var(--font-size-xs);
  color: var(--agent-text-secondary, #aaa);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  background: rgba(0, 0, 0, 0.15);
  padding: 8px 10px;
  border-radius: var(--agent-radius-sm, 8px);
  max-height: 200px;
  overflow-y: auto;
}

.ap-chunks {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ap-chunk-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.2));
  border-radius: var(--agent-radius-sm, 8px);
  cursor: pointer;
}
.ap-chunk-item:hover { border-color: var(--agent-primary, #6c5ce7); }

.ap-chunk-info { flex: 1; min-width: 0; }

.ap-chunk-title {
  font-size: var(--font-size-xs);
  color: var(--agent-text, #e0e0e0);
  font-weight: var(--font-weight-medium);
}

.ap-chunk-meta {
  display: flex;
  gap: 8px;
  font-size: 10px;
  color: var(--agent-text-tertiary, #666);
  margin-top: 2px;
}

.ap-type-text { color: #6cf; }
.ap-type-tool_call { color: var(--agent-warning, #fdcb6e); }
.ap-type-entity_op { color: #6c8; }
.ap-type-code { color: #a6c; }
.ap-type-analysis { color: #6cc; }
.ap-type-creative { color: #c6c; }

.ap-chunk-anchor {
  font-size: 10px;
  color: var(--agent-text-tertiary, #666);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ap-tags-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.ap-tag-removable {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ap-tag-remove {
  background: none;
  border: none;
  color: var(--agent-text-tertiary, #666);
  cursor: pointer;
  font-size: 10px;
  padding: 0;
  line-height: 1;
}
.ap-tag-remove:hover { color: var(--agent-danger, #e57373); }

.ap-tag-input {
  background: transparent;
  border: 1px dashed var(--agent-border, rgba(58, 58, 106, 0.4));
  color: var(--agent-text, #e0e0e0);
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 10px;
  width: 100px;
  outline: none;
  font-family: var(--agent-font, sans-serif);
}
.ap-tag-input:focus { border-color: var(--agent-primary, #6c5ce7); border-style: solid; }

.ap-detail-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.ap-action-btn {
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
}
.ap-action-btn:hover { background: var(--agent-accent-bg, rgba(108, 92, 231, 0.15)); }
.ap-action-btn.ap-danger { color: var(--agent-danger, #e57373); border-color: var(--agent-danger, #e57373); }
.ap-action-btn.ap-danger:hover { background: rgba(229, 115, 115, 0.1); }

/* 搜索视图 */
.ap-search {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ap-search-bar {
  display: flex;
  gap: 4px;
}

.ap-search-input {
  flex: 1;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  color: var(--agent-text, #e0e0e0);
  padding: 6px 10px;
  border-radius: var(--agent-radius-sm, 8px);
  font-size: var(--font-size-xs);
  outline: none;
  font-family: var(--agent-font, sans-serif);
}
.ap-search-input:focus { border-color: var(--agent-primary, #6c5ce7); }

.ap-search-mode {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  color: var(--agent-text, #e0e0e0);
  padding: 6px 8px;
  border-radius: var(--agent-radius-sm, 8px);
  font-size: var(--font-size-xs);
  outline: none;
  font-family: var(--agent-font, sans-serif);
}

.ap-search-btn {
  background: var(--agent-primary, #6c5ce7);
  border: none;
  color: white;
  padding: 6px 10px;
  border-radius: var(--agent-radius-sm, 8px);
  cursor: pointer;
  display: flex;
  align-items: center;
}
.ap-search-btn:hover { opacity: 0.85; }

.ap-search-results {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ap-search-item {
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.2));
  border-radius: var(--agent-radius-sm, 8px);
  cursor: pointer;
}
.ap-search-item:hover { border-color: var(--agent-primary, #6c5ce7); }

.ap-search-header {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-xs);
  margin-bottom: 2px;
}

.ap-search-score {
  color: var(--agent-warning, #fdcb6e);
  font-family: var(--agent-font-mono, monospace);
}

/* H4.2: score 可视化条 */
.ap-search-score-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  height: 4px;
  position: relative;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 2px;
  overflow: hidden;
}
.ap-search-score-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: var(--agent-primary, #6c5ce7);
  border-radius: 2px;
  transition: width 0.3s ease;
}
.ap-search-score-bar .ap-search-score {
  position: relative;
  z-index: 1;
  font-size: 10px;
  padding-left: 6px;
}

/* H3.4: 搜索模式说明 */
.ap-search-hint {
  font-size: var(--text-micro-font-size);
  color: var(--agent-text-tertiary, #666);
  padding: 2px 0;
  margin-bottom: 4px;
}

/* H4.2: 匹配字段标签 */
.ap-matched-field {
  display: inline-block;
  padding: 1px 6px;
  margin-right: 4px;
  border-radius: 3px;
  font-size: 10px;
  background: rgba(108, 92, 231, 0.15);
  color: var(--agent-text-secondary, #aaa);
}
.ap-matched-field.ap-matched-keyword {
  background: rgba(46, 204, 113, 0.15);
  color: #2ecc71;
}
.ap-matched-field.ap-matched-chunkTitle {
  background: rgba(52, 152, 219, 0.15);
  color: #3498db;
}

.ap-matched {
  font-size: 10px;
  color: var(--agent-text-tertiary, #666);
  margin-top: 2px;
}

/* 统计视图 */
.ap-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

/* H3.1+H3.2 回收站视图样式 */
.ap-trash {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ap-trash-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}
.ap-trash-count {
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary, #aaa);
}
.ap-trash-empty-btn {
  padding: 4px 10px;
  border: 1px solid var(--agent-danger, #e74c3c);
  background: transparent;
  color: var(--agent-danger, #e74c3c);
  border-radius: var(--agent-radius-sm, 8px);
  cursor: pointer;
  font-size: var(--font-size-xs);
}
.ap-trash-empty-btn.confirm {
  background: var(--agent-danger, #e74c3c);
  color: white;
}
.ap-trash-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ap-trash-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.2));
  border-radius: var(--agent-radius-sm, 8px);
}
.ap-trash-info {
  flex: 1;
  min-width: 0;
}
.ap-trash-summary {
  font-size: var(--font-size-xs);
  color: var(--agent-text, #e0e0e0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}
.ap-trash-meta {
  display: flex;
  gap: 8px;
  font-size: var(--text-micro-font-size);
  color: var(--agent-text-tertiary, #666);
}
.ap-trash-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.ap-trash-restore {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  background: transparent;
  color: var(--agent-text-secondary, #aaa);
  border-radius: var(--agent-radius-sm, 6px);
  cursor: pointer;
  font-size: var(--text-micro-font-size);
}
.ap-trash-restore:hover {
  background: var(--agent-accent-bg, rgba(108, 92, 231, 0.15));
}
.ap-trash-perm-delete {
  display: flex;
  align-items: center;
  padding: 4px 6px;
  border: 1px solid var(--agent-danger, #e74c3c);
  background: transparent;
  color: var(--agent-danger, #e74c3c);
  border-radius: var(--agent-radius-sm, 6px);
  cursor: pointer;
}
.ap-trash-perm-delete:hover {
  background: rgba(231, 76, 60, 0.15);
}

.ap-stat-item {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.2));
  border-radius: var(--agent-radius-sm, 8px);
  padding: 10px 12px;
}

/* H3.5 新增统计项样式 */
.ap-stat-highlight {
  border-color: var(--agent-primary, rgba(108, 92, 231, 0.3));
  background: rgba(108, 92, 231, 0.08);
}
.ap-stat-warn {
  border-color: var(--agent-warning, rgba(243, 156, 18, 0.4));
  background: rgba(243, 156, 18, 0.08);
}

.ap-stat-label {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary, #666);
  margin-bottom: 4px;
}

.ap-stat-value {
  font-size: var(--font-size-lg);
  color: var(--agent-text, #e0e0e0);
  font-weight: var(--font-weight-medium);
  font-family: var(--agent-font-mono, monospace);
}

/* 底部操作栏 */
.ap-footer {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--agent-border, rgba(58, 58, 106, 0.3));
}

.ap-footer-btn {
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
.ap-footer-btn:hover:not(:disabled) { background: var(--agent-accent-bg, rgba(108, 92, 231, 0.15)); }
.ap-footer-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ap-footer-btn.ap-primary {
  background: var(--agent-primary, #6c5ce7);
  border-color: var(--agent-primary, #6c5ce7);
  color: white;
}
.ap-footer-btn.ap-primary:hover:not(:disabled) { opacity: 0.85; }

/* 周期任务操作区（P4 新增） */
.ap-scheduler-section {
  margin-top: 12px;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.2));
  border-radius: var(--agent-radius-sm, 8px);
}

.ap-meta-info {
  margin: 8px 0;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: var(--agent-radius-sm, 6px);
}

.ap-meta-warn {
  color: var(--agent-warning, #fdcb6e);
}

.ap-scheduler-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0;
}

.ap-scheduler-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  background: transparent;
  color: var(--agent-text, #e0e0e0);
  border-radius: var(--agent-radius-sm, 6px);
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-family: var(--agent-font, sans-serif);
}
.ap-scheduler-btn:hover:not(:disabled) {
  background: var(--agent-accent-bg, rgba(108, 92, 231, 0.15));
  border-color: var(--agent-primary, #6c5ce7);
}
.ap-scheduler-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ap-scheduler-btn.ap-scheduler-stop {
  color: var(--agent-danger, #e57373);
  border-color: var(--agent-danger, #e57373);
}
.ap-scheduler-btn.ap-scheduler-stop:hover {
  background: rgba(229, 115, 115, 0.1);
}

.ap-task-log {
  margin-top: 8px;
  padding: 6px 10px;
  font-size: var(--font-size-xs);
  border-radius: var(--agent-radius-sm, 6px);
  line-height: 1.5;
}
.ap-task-log-success {
  background: rgba(100, 200, 100, 0.1);
  color: #6c8;
  border: 1px solid rgba(100, 200, 100, 0.3);
}
.ap-task-log-failed {
  background: rgba(200, 100, 100, 0.1);
  color: #c68;
  border: 1px solid rgba(200, 100, 100, 0.3);
}
.ap-task-log-partial {
  background: rgba(253, 203, 110, 0.1);
  color: var(--agent-warning, #fdcb6e);
  border: 1px solid rgba(253, 203, 110, 0.3);
}

/* H5.3 待合并视图 */
.ap-merge {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ap-merge-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
}
.ap-merge-count {
  font-weight: 600;
  color: var(--agent-text-primary, #e4e4e7);
}
.ap-merge-actions {
  display: flex;
  gap: 6px;
}
.ap-merge-confirm-all,
.ap-merge-confirm-btn {
  padding: 4px 10px;
  font-size: 11px;
  border: 1px solid var(--agent-primary, #6c5ce7);
  background: rgba(108, 92, 231, 0.15);
  color: var(--agent-primary, #6c5ce7);
  border-radius: var(--agent-radius-sm, 6px);
  cursor: pointer;
}
.ap-merge-confirm-all:hover:not(:disabled),
.ap-merge-confirm-btn:hover:not(:disabled) {
  background: rgba(108, 92, 231, 0.25);
}
.ap-merge-confirm-all:disabled,
.ap-merge-confirm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ap-merge-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ap-merge-group {
  padding: 10px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.2));
  border-radius: var(--agent-radius-sm, 8px);
}
.ap-merge-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.ap-merge-group-title {
  font-weight: 600;
  font-size: 12px;
  color: var(--agent-text-primary, #e4e4e7);
}
.ap-merge-group-count {
  font-size: 11px;
  color: var(--agent-text-muted, #71717a);
}
.ap-merge-main,
.ap-merge-pending {
  margin-bottom: 6px;
}
.ap-merge-label {
  font-size: 10px;
  color: var(--agent-text-muted, #71717a);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.ap-merge-hook-card {
  padding: 8px;
  border-radius: var(--agent-radius-sm, 6px);
  margin-bottom: 4px;
}
.ap-merge-main-card {
  background: rgba(108, 92, 231, 0.08);
  border: 1px solid rgba(108, 92, 231, 0.2);
}
.ap-merge-pending-card {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.15));
  opacity: 0.8;
}
.ap-merge-hook-summary {
  font-size: 12px;
  color: var(--agent-text-primary, #e4e4e7);
  margin-bottom: 4px;
  line-height: 1.4;
}
.ap-merge-hook-meta {
  display: flex;
  gap: 8px;
  font-size: 10px;
  color: var(--agent-text-muted, #71717a);
}
.ap-merge-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 4px;
}
.ap-tab-merge {
  position: relative;
}
.ap-tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  margin-left: 4px;
  font-size: 10px;
  font-weight: 700;
  color: white;
  background: var(--agent-warning, #fdcb6e);
  border-radius: 8px;
}
</style>
