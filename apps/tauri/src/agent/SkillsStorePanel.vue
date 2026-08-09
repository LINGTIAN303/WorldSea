<template>
  <div class="skills-store">
    <!-- 非 Tauri 环境提示 -->
    <div v-if="!store.isTauri" class="store-hint">
      <WsIcon name="globe" size="xs" /> 商城功能仅在桌面端可用（需 Tauri 运行时）
    </div>

    <template v-else>
      <!-- 技能源配置区 -->
      <div class="store-section">
        <button class="store-section-toggle" @click="sourcePanelOpen = !sourcePanelOpen">
          <WsIcon :name="sourcePanelOpen ? 'grip' : 'star'" size="xs" />
          技能源配置
          <span class="store-section-count">{{ store.skillSources.value.length }}</span>
        </button>
        <Transition name="ws-slide-up">
          <div v-if="sourcePanelOpen" class="store-source-list">
            <div v-for="(src, idx) in store.skillSources.value" :key="idx" class="store-source-item" :class="{ disabled: !src.enabled }">
              <button class="source-toggle" @click="store.toggleSource(idx)" :title="src.enabled ? '点击禁用' : '点击启用'">
                <WsIcon :name="src.enabled ? 'check' : 'close'" size="xs" />
              </button>
              <div class="source-info">
                <span class="source-name">{{ src.name }}</span>
                <span class="source-url">{{ src.manifestUrl }}</span>
              </div>
              <button class="source-delete-btn" @click="store.removeSource(idx)" title="删除"><WsIcon name="delete" size="xs" /></button>
            </div>
            <div v-if="sourceAdding" class="store-source-form">
              <div class="settings-row">
                <span class="sp-row-label">名称</span>
                <input type="text" class="settings-input" v-model="sourceForm.name" placeholder="官方精选技能集" aria-label="技能源名称" />
              </div>
              <div class="settings-row">
                <span class="sp-row-label">URL</span>
                <input type="text" class="settings-input" v-model="sourceForm.url" placeholder="https://raw.githubusercontent.com/.../skills-manifest.json" aria-label="技能源 manifest URL" />
              </div>
              <div class="store-source-actions">
                <button class="sub-panel-btn" @click="confirmAddSource">确认</button>
                <button class="sub-panel-btn" @click="sourceAdding = false">取消</button>
              </div>
            </div>
            <button v-else class="sub-panel-btn" @click="sourceAdding = true" style="width:100%">+ 添加技能源</button>
          </div>
        </Transition>
      </div>

      <!-- 本地导入区（Task 24 阶段4：多平台互通） -->
      <div class="store-section">
        <button class="store-section-toggle" @click="importPanelOpen = !importPanelOpen">
          <WsIcon name="plus" size="xs" />
          本地导入（Claude Code / Cursor / WorldSmith）
        </button>
        <Transition name="ws-slide-up">
          <div v-if="importPanelOpen" class="store-import-area">
            <p class="store-import-hint">
              选择外部技能文件（SKILL.md / .mdc / skill.yaml），自动识别格式并导入为 WorldSmith 技能。已存在同名技能会覆盖。
            </p>
            <input
              ref="fileInputRef"
              type="file"
              accept=".md,.mdc,.yaml,.yml"
              style="display:none"
              @change="onFileSelected"
            />
            <button class="sub-panel-btn" @click="fileInputRef?.click()" :disabled="importing">
              <WsIcon name="plus" size="xs" />
              {{ importing ? '导入中...' : '选择文件导入' }}
            </button>
            <div v-if="importResult" class="store-import-result" :class="{ success: importResult.success }">
              <WsIcon :name="importResult.success ? 'check' : 'close'" size="xs" />
              <span>{{ importResult.success ? `导入成功（${importResult.platform} 格式）` : '导入失败' }}</span>
              <span v-if="importResult.warnings.length" class="store-import-warnings">
                {{ importResult.warnings.join('；') }}
              </span>
            </div>
          </div>
        </Transition>
      </div>

      <!-- 商城浏览区 -->
      <div class="store-section">
        <div class="store-browse-header">
          <button class="store-section-toggle" @click="refreshStore" :disabled="store.loading.value">
            <WsIcon name="search" size="xs" />
            {{ store.loading.value ? '加载中...' : '刷新商城' }}
          </button>
          <input
            v-model="searchQuery"
            type="text"
            class="settings-input store-search"
            placeholder="搜索技能..."
            aria-label="搜索技能"
          />
        </div>

        <div v-if="store.error.value" class="store-error">{{ store.error.value }}</div>

        <div v-if="filteredSkills.length === 0 && !store.loading.value" class="store-empty">
          <template v-if="store.remoteSkills.value.length === 0">
            暂无可用技能，请添加技能源并刷新
          </template>
          <template v-else>
            未找到匹配的技能
          </template>
        </div>

        <div class="store-skill-grid">
          <div v-for="skill in filteredSkills" :key="skill.id" class="store-skill-card">
            <div class="store-skill-header">
              <span class="store-skill-name">{{ skill.name }}</span>
              <span class="store-skill-version">v{{ skill.version }}</span>
            </div>
            <div class="store-skill-desc">{{ skill.description || '暂无描述' }}</div>
            <div class="store-skill-meta">
              <span v-if="skill.author" class="store-skill-author"><WsIcon name="star" size="xs" /> {{ skill.author }}</span>
              <span v-if="store.isInstalled(skill.id)" class="store-skill-installed-tag">
                已安装 v{{ store.installedVersionMap.value.get(skill.id) }}
              </span>
            </div>
            <div class="store-skill-actions">
              <!-- 未安装：安装按钮 -->
              <button
                v-if="!store.isInstalled(skill.id)"
                class="sub-panel-btn store-action-btn"
                :disabled="store.installing.value === skill.id"
                @click="onInstall(skill)"
              >
                <WsIcon name="check" size="xs" />
                {{ store.installing.value === skill.id ? '安装中...' : '安装' }}
              </button>
              <!-- 已安装但有更新：更新按钮 -->
              <button
                v-else-if="store.hasUpdate(skill)"
                class="sub-panel-btn store-action-btn store-update-btn"
                :disabled="store.installing.value === skill.id"
                @click="onInstall(skill)"
              >
                <WsIcon name="timeline" size="xs" />
                {{ store.installing.value === skill.id ? '更新中...' : '更新' }}
              </button>
              <!-- 已安装最新：卸载按钮 -->
              <button
                v-else
                class="sub-panel-btn store-action-btn store-uninstall-btn"
                :disabled="store.installing.value === skill.id"
                @click="onUninstall(skill.id)"
              >
                <WsIcon name="delete" size="xs" />
                {{ store.installing.value === skill.id ? '卸载中...' : '卸载' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useSkillsStore } from '@worldsmith/shared-composables/agent/useSkillsStore'
import type { RemoteSkillEntry } from '@agent/index'

const emit = defineEmits<{ 'skills-changed': [] }>()

const store = useSkillsStore()

const sourcePanelOpen = ref(false)
const sourceAdding = ref(false)
const sourceForm = ref({ name: '', url: '' })
const searchQuery = ref('')

// 本地导入状态（Task 24 阶段4）
const importPanelOpen = ref(false)
const importing = ref(false)
const importResult = ref<{ success: boolean; warnings: string[]; platform: string } | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

/** 搜索过滤后的远程技能列表 */
const filteredSkills = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return store.remoteSkills.value
  return store.remoteSkills.value.filter((s: { name: string; id: string; description?: string }) =>
    s.name.toLowerCase().includes(q) ||
    s.id.toLowerCase().includes(q) ||
    (s.description || '').toLowerCase().includes(q),
  )
})

/** 确认添加技能源 */
function confirmAddSource(): void {
  if (sourceForm.value.name.trim() && sourceForm.value.url.trim()) {
    store.addSource(sourceForm.value.name, sourceForm.value.url)
    sourceForm.value = { name: '', url: '' }
    sourceAdding.value = false
  }
}

/** 刷新商城（远程 + 已安装） */
async function refreshStore(): Promise<void> {
  await Promise.all([store.refreshRemote(), store.refreshInstalled()])
}

/** 安装/更新技能，完成后通知父组件刷新技能列表 */
async function onInstall(skill: RemoteSkillEntry): Promise<void> {
  const ok = await store.installSkill(skill)
  if (ok) emit('skills-changed')
}

/** 卸载技能，完成后通知父组件刷新技能列表 */
async function onUninstall(skillId: string): Promise<void> {
  const ok = await store.uninstallSkill(skillId)
  if (ok) emit('skills-changed')
}

/** 本地导入技能：读取文件 → autoImportSkill 解析 → 写入 skills 目录 */
async function onFileSelected(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importing.value = true
  importResult.value = null
  try {
    const text = await file.text()
    // 用文件名（去扩展名）作为 fallbackId，清洗非法字符
    const fallbackId = file.name.replace(/\.(md|mdc|ya?ml)$/i, '').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-')
    const result = await store.importLocal(text, fallbackId)
    importResult.value = result
    if (result.success) emit('skills-changed')
  } catch (err: any) {
    importResult.value = { success: false, warnings: [err?.message || '读取文件失败'], platform: 'unknown' }
  } finally {
    importing.value = false
    input.value = '' // 重置，允许重复选择同一文件
  }
}

onMounted(() => {
  // 桌面端自动加载已安装版本（不自动刷新远程，避免无源时无效请求）
  if (store.isTauri) {
    store.refreshInstalled()
  }
})
</script>

<style scoped>
.skills-store {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
}

.store-hint {
  padding: 10px 12px;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  gap: 6px;
}

.store-section {
  margin-bottom: 14px;
}

.store-section-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}
.store-section-toggle:hover {
  background: var(--color-surface-hover);
}
.store-section-toggle:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.store-section-count {
  margin-left: auto;
  padding: 1px 8px;
  background: var(--color-primary);
  color: #fff;
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
}

.store-source-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.store-source-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
}
.store-source-item.disabled {
  opacity: 0.5;
}

.source-toggle {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
}
.source-toggle:hover {
  background: var(--color-surface);
}

.source-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.source-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text);
}
.source-url {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-delete-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
}
.source-delete-btn:hover {
  background: var(--color-surface);
  color: var(--color-error);
}

.store-source-form {
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}

.store-source-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.store-browse-header {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.store-browse-header .store-section-toggle {
  width: auto;
  flex-shrink: 0;
}
.store-search {
  flex: 1;
  min-width: 0;
}

.store-error {
  padding: 8px 10px;
  font-size: var(--font-size-sm);
  color: var(--color-error);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  margin-bottom: 8px;
}

.store-empty {
  padding: 16px;
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.store-skill-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.store-skill-card {
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.store-skill-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.store-skill-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
}
.store-skill-version {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  padding: 1px 6px;
  background: var(--color-surface);
  border-radius: 4px;
  flex-shrink: 0;
}

.store-skill-desc {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.store-skill-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
.store-skill-meta span {
  display: flex;
  align-items: center;
  gap: 3px;
}
.store-skill-installed-tag {
  color: var(--color-success);
}

.store-skill-actions {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}
.store-action-btn {
  flex: 1;
  justify-content: center;
}
.store-update-btn {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}
.store-uninstall-btn {
  color: var(--color-text-tertiary);
}
.store-uninstall-btn:hover {
  color: var(--color-error);
  border-color: var(--color-error);
}

.store-import-area {
  margin-top: 8px;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
}
.store-import-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  margin: 0 0 8px 0;
  line-height: 1.5;
}
.store-import-result {
  margin-top: 8px;
  padding: 6px 10px;
  font-size: var(--font-size-xs);
  color: var(--color-error);
  background: var(--color-surface);
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.store-import-result.success {
  color: var(--color-success);
}
.store-import-warnings {
  color: var(--color-text-tertiary);
}
</style>
