<template>
  <div class="binfo-overlay" @click.self="$emit('close')">
    <div ref="dialogRef" class="binfo-dialog" role="dialog" aria-modal="true" aria-labelledby="binfo-title" tabindex="-1">
      <h3 id="binfo-title"><WsIcon name="book" size="sm" /> 书籍信息</h3>

      <!-- 封面（2026-09-14 书籍迭代·拍板图片封面）：复用 writeImageAsset 落盘
           assets/（素材面板可见、孤儿清理按 book.properties JSON 识别不误删），
           properties.cover 存 convertFileSrc 绝对 URL -->
      <div class="binfo-cover">
        <div class="binfo-cover-box">
          <img v-if="coverPreview" :src="coverPreview" alt="封面预览" />
          <div v-else class="binfo-cover-empty"><WsIcon name="book" size="xl" /></div>
        </div>
        <div class="binfo-cover-actions">
          <button class="btn-secondary btn-sm" @click="coverInput?.click()">上传封面</button>
          <button v-if="coverPreview" class="btn-secondary btn-sm" @click="pendingCover = null">移除封面</button>
        </div>
        <input ref="coverInput" type="file" accept="image/*" class="binfo-hidden-input" @change="onPickCover" />
      </div>

      <div class="binfo-field">
        <label class="binfo-label" for="binfo-name">书名</label>
        <input id="binfo-name" v-model="nameVal" class="binfo-input" placeholder="书名" />
      </div>

      <div class="binfo-field">
        <label class="binfo-label" for="binfo-desc">简介</label>
        <textarea id="binfo-desc" v-model="descVal" class="binfo-textarea" rows="4" placeholder="一句话介绍这本书（显示在书籍卡片上）"></textarea>
      </div>

      <div class="binfo-actions">
        <button class="btn-secondary" @click="$emit('close')">取消</button>
        <button class="btn-primary" :disabled="saving" @click="save">{{ saving ? '保存中...' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useEntityStore } from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'
import { writeImageAsset } from '@/composables/imageAssets'
import { toastError } from '@/composables/useToast'
import { useFocusTrap } from '@/composables/useFocusTrap'

const props = defineProps<{ book: Entity }>()
const emit = defineEmits<{ close: [] }>()

const es = useEntityStore()

const dialogRef = ref<HTMLElement | null>(null)
const { activate } = useFocusTrap(dialogRef, {
  escapeDeactivates: true,
  onEscape: () => emit('close'),
})
onMounted(() => {
  nextTick(() => activate())
})

const nameVal = ref(props.book.name)
const descVal = ref(props.book.description || '')
// 封面三态：undefined=未改动 / null=移除 / string=新封面 asset URL
const pendingCover = ref<string | null | undefined>(undefined)
const coverInput = ref<HTMLInputElement | null>(null)
const saving = ref(false)

const coverPreview = computed(() => {
  if (pendingCover.value === null) return ''
  if (pendingCover.value) return pendingCover.value
  return (props.book.properties.cover as string) || ''
})

async function onPickCover(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许连续选择同一文件
  if (!file) return
  const result = await writeImageAsset(file) // 类型/2MB 校验 + 落盘 + convertFileSrc
  if (result.ok && result.src) {
    pendingCover.value = result.src
  } else {
    toastError(result.reason || '封面上传失败')
  }
}

async function save() {
  const name = nameVal.value.trim()
  if (!name) {
    toastError('书名不能为空')
    return
  }
  saving.value = true
  try {
    // 实体更新 = properties 整体替换（entity_commands.rs:338），必须带全量
    const properties = { ...props.book.properties }
    if (pendingCover.value !== undefined) properties.cover = pendingCover.value
    await es.update(props.book.id, { name, description: descVal.value, properties })
    emit('close')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.binfo-overlay {
  position: fixed; inset: 0; background: var(--color-overlay);
  display: flex; align-items: center; justify-content: center; z-index: 300;
}
.binfo-dialog {
  background: var(--modal-bg); border-radius: var(--radius-2xl); padding: 20px;
  max-width: 420px; width: 90%;
  max-height: 90vh; overflow-y: auto;
}
.binfo-dialog h3 { margin: 0 0 14px; font-size: var(--font-size-lg); display: flex; align-items: center; gap: 6px; }

.binfo-cover { margin-bottom: 14px; }
.binfo-cover-box {
  width: 132px; height: 176px; /* 3:4 书籍封面比例 */
  margin: 0 auto; border-radius: var(--radius-md);
  border: 1px dashed var(--border-color);
  overflow: hidden; display: flex; align-items: center; justify-content: center;
  background: var(--bg-tertiary);
}
.binfo-cover-box img { width: 100%; height: 100%; object-fit: cover; display: block; }
.binfo-cover-empty { color: var(--text-tertiary); }
.binfo-cover-actions { display: flex; justify-content: center; gap: 8px; margin-top: 8px; }
.binfo-hidden-input { display: none; }

.binfo-field { margin-bottom: 12px; }
.binfo-label { display: block; font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); margin-bottom: 6px; color: var(--text-secondary); }
.binfo-input {
  width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-xs);
  font-size: var(--font-size-sm); background: var(--input-bg); color: var(--text-color);
  outline: none; box-sizing: border-box; transition: border-color 0.15s;
}
.binfo-input:focus { border-color: var(--primary); }
.binfo-textarea {
  width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-xs);
  font-size: var(--font-size-sm); background: var(--input-bg); color: var(--text-color);
  outline: none; box-sizing: border-box; resize: vertical; font-family: inherit; line-height: 1.6;
  transition: border-color 0.15s;
}
.binfo-textarea:focus { border-color: var(--primary); }

.binfo-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
