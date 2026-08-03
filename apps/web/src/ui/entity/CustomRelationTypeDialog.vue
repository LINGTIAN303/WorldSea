<template>
  <Teleport to="body">
    <div class="crt-overlay" v-if="show" @click.self="close">
      <div class="crt-modal">
        <div class="crt-header">
          <h3>自定义关系类型</h3>
          <button class="crt-close" @click="close">✕</button>
        </div>

        <div class="crt-body">
          <!-- 创建表单 -->
          <div class="crt-form">
            <div class="crt-form-title">新建关系类型</div>

            <div class="crt-field">
              <label>类型标识 <span class="crt-required">*</span></label>
              <input v-model="form.type" placeholder="如: custom_mentor" class="crt-input" />
            </div>

            <div class="crt-field">
              <label>显示名称 <span class="crt-required">*</span></label>
              <input v-model="form.label" placeholder="如: 导师" class="crt-input" />
            </div>

            <div class="crt-row">
              <div class="crt-field crt-field-half">
                <label>源实体类型 <span class="crt-required">*</span></label>
                <div class="crt-checkbox-group">
                  <label v-for="et in entityTypes" :key="et.type" class="crt-checkbox-label">
                    <input type="checkbox" :value="et.type" v-model="form.sourceTypes" />
                    {{ et.label }}
                  </label>
                </div>
              </div>
              <div class="crt-field crt-field-half">
                <label>目标实体类型 <span class="crt-required">*</span></label>
                <div class="crt-checkbox-group">
                  <label v-for="et in entityTypes" :key="et.type" class="crt-checkbox-label">
                    <input type="checkbox" :value="et.type" v-model="form.targetTypes" />
                    {{ et.label }}
                  </label>
                </div>
              </div>
            </div>

            <div class="crt-field">
              <label>逆关系类型标识</label>
              <input v-model="form.inverseType" placeholder="如: custom_apprentice" class="crt-input" />
            </div>

            <div class="crt-field">
              <label>逆关系显示名称</label>
              <input v-model="form.inverseLabel" placeholder="如: 徒弟" class="crt-input" />
            </div>

            <div class="crt-row">
              <div class="crt-field crt-field-half">
                <label>对称关系</label>
                <label class="crt-checkbox-label">
                  <input type="checkbox" v-model="form.symmetric" />
                  对称（逆关系指向自身）
                </label>
              </div>
              <div class="crt-field crt-field-half">
                <label>领域分组</label>
                <select v-model="form.domain" class="crt-select">
                  <option value="">无</option>
                  <option v-for="d in domainOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
                </select>
              </div>
            </div>

            <div class="crt-form-actions">
              <button class="btn btn-primary" @click="onCreate" :disabled="!canCreate">创建</button>
              <button class="btn" @click="resetForm">重置</button>
            </div>
          </div>

          <!-- 已有自定义类型列表 -->
          <div class="crt-list-section">
            <div class="crt-form-title">已有自定义类型 ({{ customTypes.length }})</div>
            <div v-if="customTypes.length === 0" class="crt-empty">暂无自定义关系类型</div>
            <div v-for="ct in customTypes" :key="ct.type" class="crt-list-item">
              <div class="crt-list-item-info">
                <span class="crt-list-item-type">{{ ct.type }}</span>
                <span class="crt-list-item-label">{{ ct.label }}</span>
                <span class="crt-list-item-domain" v-if="ct.domain">{{ domainLabel(ct.domain) }}</span>
              </div>
              <button class="btn btn-sm btn-danger" @click="onDelete(ct.type)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { relationshipRegistry, entitySchemaRegistry } from '@worldsmith/entity-core'
import type { RelationTypeSchemaV2 } from '@worldsmith/entity-core'

defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const domainOptions = [
  { value: 'person', label: '人物' },
  { value: 'geography', label: '地理' },
  { value: 'ownership', label: '归属' },
  { value: 'temporal', label: '时间' },
  { value: 'social', label: '社会' },
  { value: 'other', label: '其他' },
]

const entityTypes = computed(() => entitySchemaRegistry.getAll())

const customTypes = ref<RelationTypeSchemaV2[]>(relationshipRegistry.getCustomTypes())

function refreshCustomTypes() {
  customTypes.value = relationshipRegistry.getCustomTypes()
}

const form = reactive({
  type: '',
  label: '',
  sourceTypes: [] as string[],
  targetTypes: [] as string[],
  inverseType: '',
  inverseLabel: '',
  symmetric: false,
  domain: '',
})

const canCreate = computed(() => {
  return form.type.trim() !== ''
    && form.label.trim() !== ''
    && form.sourceTypes.length > 0
    && form.targetTypes.length > 0
    && !relationshipRegistry.has(form.type.trim())
})

function resetForm() {
  form.type = ''
  form.label = ''
  form.sourceTypes = []
  form.targetTypes = []
  form.inverseType = ''
  form.inverseLabel = ''
  form.symmetric = false
  form.domain = ''
}

function onCreate() {
  if (!canCreate.value) return

  const inverseType = form.inverseType.trim() || form.type.trim() + '_inverse'
  const inverseLabel = form.inverseLabel.trim() || form.label.trim() + '（逆）'

  relationshipRegistry.registerCustom({
    type: form.type.trim(),
    label: form.label.trim(),
    sourceTypes: [...form.sourceTypes],
    targetTypes: [...form.targetTypes],
    inverseType: form.symmetric ? form.type.trim() : inverseType,
    inverseLabel: form.symmetric ? form.label.trim() : inverseLabel,
    symmetric: form.symmetric,
    domain: form.domain || undefined,
  })

  refreshCustomTypes()
  resetForm()
}

function onDelete(type: string) {
  if (confirm(`确定删除自定义关系类型 "${type}"？已有关系数据不会被删除。`)) {
    relationshipRegistry.unregisterCustom(type)
    refreshCustomTypes()
  }
}

function domainLabel(domain: string): string {
  const found = domainOptions.find(d => d.value === domain)
  return found ? found.label : domain
}

function close() {
  emit('close')
}
</script>

<style scoped>
.crt-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
}
.crt-modal {
  width: 620px;
  max-height: 80vh;
  background: var(--content-bg);
  border-radius: 12px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.crt-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
}
.crt-header h3 {
  margin: 0;
  font-size: var(--font-size-lg);
}
.crt-close {
  background: none;
  border: none;
  font-size: var(--font-size-xl);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}
.crt-close:hover {
  background: var(--hover-bg);
}
.crt-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}
.crt-form {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
.crt-form-title {
  font-weight: var(--font-weight-semibold);
  margin-bottom: 12px;
  font-size: var(--font-size-md);
}
.crt-field {
  margin-bottom: 10px;
}
.crt-field label {
  display: block;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.crt-required {
  color: var(--danger);
}
.crt-input,
.crt-select {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  box-sizing: border-box;
}
.crt-input:focus,
.crt-select:focus {
  outline: none;
  border-color: var(--primary);
}
.crt-row {
  display: flex;
  gap: 16px;
}
.crt-field-half {
  flex: 1;
  min-width: 0;
}
.crt-checkbox-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 120px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  background: var(--bg);
}
.crt-checkbox-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
  cursor: pointer;
  white-space: nowrap;
}
.crt-form-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.btn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  cursor: pointer;
  font-size: var(--font-size-sm);
}
.btn:hover {
  background: var(--bg-hover);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn.btn-sm {
  padding: 3px 8px;
  font-size: var(--font-size-xs);
}
.btn.btn-primary {
  color: #fff;
  background: var(--primary);
  border-color: var(--primary);
}
.btn.btn-primary:hover {
  opacity: 0.9;
}
.btn.btn-danger {
  color: var(--danger);
  border-color: var(--danger);
}
.btn.btn-danger:hover {
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}
.crt-list-section {
  margin-top: 4px;
}
.crt-empty {
  text-align: center;
  padding: 20px;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}
.crt-list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.crt-list-item:last-child {
  border-bottom: none;
}
.crt-list-item-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.crt-list-item-type {
  font-family: monospace;
  font-size: var(--font-size-xs);
  background: var(--bg);
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}
.crt-list-item-label {
  font-weight: var(--font-weight-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.crt-list-item-domain {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  background: var(--bg);
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}
</style>
