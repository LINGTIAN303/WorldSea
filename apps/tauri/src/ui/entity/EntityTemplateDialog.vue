<template>
  <Teleport to="body">
    <div class="et-overlay" v-if="show" @click.self="close">
      <div class="et-modal">
        <div class="et-header">
          <h3>实体模板</h3>
          <button class="et-close" @click="close">✕</button>
        </div>

        <div class="et-tabs">
          <button :class="{ active: tab === 'entity' }" @click="tab = 'entity'">实体模板</button>
          <button :class="{ active: tab === 'world' }" @click="tab = 'world'">世界观模板</button>
        </div>

        <!-- 实体模板 -->
        <div v-if="tab === 'entity'" class="et-body">
          <select v-model="typeFilter" class="et-select">
            <option value="">全部类型</option>
            <option v-for="t in allTypes" :key="t.typeKey" :value="t.typeKey">{{ t.label }}</option>
          </select>

          <div class="et-list" v-if="filteredEntityTemplates.length">
            <div v-for="tmpl in filteredEntityTemplates" :key="tmpl.id" class="et-card" @click="onApplyEntityTemplate(tmpl)">
              <div class="et-card-icon">{{ entitySchemaRegistry.getEmoji(tmpl.entityType) }}</div>
              <div class="et-card-content">
                <div class="et-card-h">
                  <strong>{{ tmpl.name }}</strong>
                  <span class="et-type-badge">{{ entitySchemaRegistry.getLabel(tmpl.entityType) }}</span>
                  <span v-if="tmpl.source === 'builtin'" class="et-source-badge builtin">内置</span>
                  <span v-else class="et-source-badge custom">自定义</span>
                </div>
                <div class="et-card-props" v-if="Object.keys(tmpl.defaultProperties).length">
                  <span v-for="(val, key) in previewProps(tmpl.defaultProperties)" :key="key" class="et-prop-tag">{{ key }}: {{ val }}</span>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="et-empty">无匹配模板</div>
        </div>

        <!-- 世界观模板 -->
        <div v-if="tab === 'world'" class="et-body">
          <div class="et-list" v-if="worldTemplates.length">
            <div v-for="wt in worldTemplates" :key="wt.id" class="et-card et-card-world" @click="onApplyWorldTemplate(wt)">
              <div class="et-card-icon">{{ wt.icon === 'castle' ? '🏰' : '🌍' }}</div>
              <div class="et-card-content">
                <div class="et-card-h">
                  <strong>{{ wt.name }}</strong>
                  <span v-if="wt.source === 'builtin'" class="et-source-badge builtin">内置</span>
                  <span v-else class="et-source-badge custom">自定义</span>
                </div>
                <p class="et-card-desc">{{ wt.description }}</p>
                <div class="et-card-entities">
                  <span v-for="(entry, i) in wt.entityTemplates" :key="i" class="et-prop-tag">{{ entry.template.name }} ×{{ entry.count }}</span>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="et-empty">无世界观模板</div>
        </div>

        <!-- 名称输入弹窗 -->
        <div v-if="nameInputVisible" class="et-name-overlay" @click.self="cancelNameInput">
          <div class="et-name-modal">
            <h4>创建实体</h4>
            <input
              ref="nameInputRef"
              v-model="nameInputValue"
              class="et-name-input"
              placeholder="输入实体名称"
              @keydown.enter="confirmNameInput"
              @keydown.escape="cancelNameInput"
            />
            <div class="et-name-actions">
              <button class="et-btn" @click="cancelNameInput">取消</button>
              <button class="et-btn primary" @click="confirmNameInput">创建</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useEntityTemplates, entitySchemaRegistry } from '@worldsmith/entity-core'
import type { EntityTemplate, WorldTemplate } from '@worldsmith/entity-core'

defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const {
  getTemplatesForType,
  getWorldTemplates,
  createFromTemplate,
  createFromWorldTemplate,
} = useEntityTemplates()

const allTypes = computed(() => entitySchemaRegistry.getAll())
const tab = ref<'entity' | 'world'>('entity')
const typeFilter = ref('')

const filteredEntityTemplates = computed(() => {
  if (!typeFilter.value) {
    // 聚合所有类型的模板
    const allEntityTypes = allTypes.value.map(t => t.typeKey)
    const result: EntityTemplate[] = []
    for (const et of allEntityTypes) {
      result.push(...getTemplatesForType(et))
    }
    return result
  }
  return getTemplatesForType(typeFilter.value)
})

const worldTemplates = computed(() => getWorldTemplates())

function previewProps(props: Record<string, string>): Record<string, string> {
  const entries = Object.entries(props).slice(0, 3)
  return Object.fromEntries(entries)
}

// 名称输入状态
const nameInputVisible = ref(false)
const nameInputValue = ref('')
const nameInputRef = ref<HTMLInputElement | null>(null)
let pendingTemplate: EntityTemplate | null = null

async function onApplyEntityTemplate(tmpl: EntityTemplate) {
  pendingTemplate = tmpl
  nameInputValue.value = tmpl.name
  nameInputVisible.value = true
  await nextTick()
  nameInputRef.value?.focus()
  nameInputRef.value?.select()
}

async function confirmNameInput() {
  if (!pendingTemplate) return
  const name = nameInputValue.value.trim()
  if (!name) return
  await createFromTemplate(pendingTemplate, name)
  nameInputVisible.value = false
  pendingTemplate = null
  close()
}

function cancelNameInput() {
  nameInputVisible.value = false
  pendingTemplate = null
}

async function onApplyWorldTemplate(wt: WorldTemplate) {
  await createFromWorldTemplate(wt)
  close()
}

function close() {
  tab.value = 'entity'
  typeFilter.value = ''
  nameInputVisible.value = false
  pendingTemplate = null
  emit('close')
}
</script>

<style scoped>
.et-overlay { position: fixed; inset: 0; z-index: var(--z-overlay); background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; }
.et-modal { width: 560px; max-height: 75vh; background: var(--content-bg); border-radius: var(--radius-2xl); box-shadow: 0 8px 40px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: hidden; position: relative; }
.et-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid var(--border); }
.et-header h3 { margin: 0; font-size: var(--font-size-lg); }
.et-close { background: none; border: none; font-size: var(--font-size-xl); cursor: pointer; padding: 4px 8px; border-radius: var(--radius-xs); }
.et-close:hover { background: var(--hover-bg); }
.et-tabs { display: flex; border-bottom: 1px solid var(--border); }
.et-tabs button { flex: 1; padding: 8px; border: none; background: var(--bg); cursor: pointer; font-size: var(--font-size-base); color: var(--text-secondary); transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; }
.et-tabs button.active { background: var(--primary); color: var(--text-on-primary, #fff); }
.et-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
.et-select { width: 100%; padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-xs); margin-bottom: 12px; background: var(--bg); color: var(--text); }
.et-list { display: flex; flex-direction: column; gap: 8px; }
.et-card { border: 1px solid var(--border); border-radius: var(--radius-mid); padding: 12px; display: flex; gap: 12px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.et-card:hover { border-color: var(--primary); background: var(--hover-bg); }
.et-card-icon { font-size: 24px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: var(--radius-mid); background: var(--bg); }
.et-card-content { flex: 1; min-width: 0; }
.et-card-h { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; flex-wrap: wrap; }
.et-card-h strong { font-size: var(--font-size-base); }
.et-type-badge { font-size: var(--font-size-xs); background: #eef2ff; color: var(--primary); padding: 2px 6px; border-radius: var(--radius-xs); }
.et-source-badge { font-size: var(--font-size-xs); padding: 1px 5px; border-radius: var(--radius-2xs); }
.et-source-badge.builtin { background: #ecfdf5; color: #059669; }
.et-source-badge.custom { background: #fef3c7; color: #d97706; }
.et-card-desc { font-size: var(--font-size-sm); color: var(--text-secondary); margin: 4px 0; }
.et-card-props, .et-card-entities { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.et-prop-tag { font-size: var(--font-size-xs); background: var(--bg); color: var(--text-secondary); padding: 2px 6px; border-radius: var(--radius-2xs); border: 1px solid var(--border); }
.et-empty { text-align: center; padding: 40px; color: var(--text-tertiary); }

/* 名称输入弹窗 */
.et-name-overlay { position: absolute; inset: 0; z-index: 10; background: rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: center; border-radius: var(--radius-2xl); }
.et-name-modal { background: var(--content-bg); border-radius: var(--radius-mid); padding: 20px; width: 320px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); }
.et-name-modal h4 { margin: 0 0 12px; font-size: var(--font-size-base); }
.et-name-input { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: var(--font-size-base); background: var(--bg); color: var(--text); box-sizing: border-box; }
.et-name-input:focus { outline: none; border-color: var(--primary); }
.et-name-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.et-btn { padding: 6px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); cursor: pointer; font-size: var(--font-size-sm); color: var(--text); }
.et-btn:hover { background: var(--bg-hover); }
.et-btn.primary { background: var(--primary); color: var(--text-on-primary, #fff); border-color: var(--primary); }
.et-btn.primary:hover { opacity: 0.9; }
</style>
