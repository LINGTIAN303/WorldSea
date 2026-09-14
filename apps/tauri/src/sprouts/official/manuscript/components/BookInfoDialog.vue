<template>
  <div class="binfo-overlay" @click.self="$emit('close')">
    <div ref="dialogRef" class="binfo-dialog" role="dialog" aria-modal="true" aria-labelledby="binfo-title" tabindex="-1">
      <h3 id="binfo-title"><WsIcon name="book" size="sm" /> {{ isCreate ? '新建书籍' : '书籍信息' }}</h3>

      <!-- 封面（2026-09-14 书籍迭代·拍板图片封面）：保存时经 writeImageAsset 落盘
           assets/（素材面板可见、孤儿清理按 book.properties JSON 识别不误删）。
           上传时机 = 保存时（选文件仅本地预览）——取消/关闭不残留无引用图片文件 -->
      <div class="binfo-cover">
        <div class="binfo-cover-box">
          <img v-if="coverPreview" :src="coverPreview" alt="封面预览" />
          <div v-else class="binfo-cover-empty"><WsIcon name="book" size="xl" /></div>
        </div>
        <div class="binfo-cover-actions">
          <button class="btn-secondary btn-sm" @click="coverInput?.click()">上传封面</button>
          <button v-if="coverPreview" class="btn-secondary btn-sm" @click="removeCover">移除封面</button>
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

      <!-- 自定义标签（2026-09-14 拍板：存实体顶层 tags 字段；回车/逗号添加，点 × 删除） -->
      <div class="binfo-field">
        <label class="binfo-label" for="binfo-tag-input">标签</label>
        <div class="binfo-tags">
          <span v-for="t in tagsVal" :key="t" class="binfo-tag">
            {{ t }}
            <button class="binfo-tag-x" :aria-label="`删除标签 ${t}`" @click="removeTag(t)"><WsIcon name="close" size="2xs" /></button>
          </span>
          <input
            id="binfo-tag-input"
            v-model="tagInput"
            class="binfo-tag-input"
            placeholder="输入后回车添加"
            @keydown.enter.prevent="addTag"
            @keydown.,.prevent="addTag"
          />
        </div>
      </div>

      <div class="binfo-actions">
        <button class="btn-secondary" @click="$emit('close')">取消</button>
        <button class="btn-primary" :disabled="saving" @click="save">{{ saving ? (isCreate ? '创建中...' : '保存中...') : (isCreate ? '创建' : '保存') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useEntityStore } from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'
import { writeImageAsset, ASSET_MAX_BYTES } from '@/composables/imageAssets'
import { toastError } from '@/composables/useToast'
import { useFocusTrap } from '@/composables/useFocusTrap'

const props = defineProps<{
  /** null/缺省 = 创建模式（确认后才 es.add 落地实体）；传实体 = 编辑模式 */
  book?: Entity | null
  /** 创建模式新书 sortOrder（父层按现有书籍数给；编辑模式忽略） */
  nextSortOrder?: number
}>()
const emit = defineEmits<{ close: [] }>()

const es = useEntityStore()

const isCreate = computed(() => !props.book)

const dialogRef = ref<HTMLElement | null>(null)
const { activate } = useFocusTrap(dialogRef, {
  escapeDeactivates: true,
  onEscape: () => emit('close'),
})
onMounted(() => {
  nextTick(() => activate())
})

const nameVal = ref(props.book?.name || '')
const descVal = ref(props.book?.description || '')

// ── 自定义标签（实体顶层 tags 字段；卡片与章节行均显示）──
const tagsVal = ref<string[]>(Array.isArray(props.book?.tags) ? [...(props.book.tags as string[])] : [])
const tagInput = ref('')

function addTag() {
  const t = tagInput.value.trim().replace(/[,，]/g, '')
  if (!t) return
  if (!tagsVal.value.includes(t)) tagsVal.value.push(t)
  tagInput.value = ''
}

function removeTag(t: string) {
  tagsVal.value = tagsVal.value.filter(x => x !== t)
}

// ── 封面状态机：选文件仅本地预览（objectURL），保存时才 writeImageAsset 落盘；
//    显式移除 = coverRemoved；两者都不沾 = 保持原值 ──
const coverFile = ref<File | null>(null)
const coverRemoved = ref(false)
const coverPreview = ref(props.book ? (props.book.properties.cover as string) || '' : '')
const coverInput = ref<HTMLInputElement | null>(null)
let previewObjectUrl = ''

function setPreview(src: string) {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl)
    previewObjectUrl = ''
  }
  coverPreview.value = src
}

/** 选择后本地预校验（与 writeImageAsset 同口径，避免保存时才发现超限） */
function onPickCover(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许连续选择同一文件
  if (!file) return
  if (!file.type.startsWith('image/')) {
    toastError(`「${file.name}」不是图片文件`)
    return
  }
  if (file.size > ASSET_MAX_BYTES) {
    toastError(`「${file.name}」超过 2MB 上限（${(file.size / 1024 / 1024).toFixed(1)}MB）`)
    return
  }
  coverFile.value = file
  coverRemoved.value = false
  previewObjectUrl = URL.createObjectURL(file)
  setPreview(previewObjectUrl)
}

function removeCover() {
  coverFile.value = null
  coverRemoved.value = true
  setPreview('')
}

onBeforeUnmount(() => {
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl)
})

const saving = ref(false)

async function save() {
  const name = nameVal.value.trim()
  if (!name) {
    toastError('书名不能为空')
    return
  }
  saving.value = true
  try {
    // 封面落盘时机 = 保存：待上传文件 → writeImageAsset；显式移除 → 清空；否则原值不动
    let cover: string | null | undefined = undefined
    if (coverFile.value) {
      const r = await writeImageAsset(coverFile.value)
      if (!r.ok || !r.src) {
        toastError(r.reason || '封面上传失败')
        return // 保留表单与已选文件，用户可重试
      }
      cover = r.src
    } else if (coverRemoved.value) {
      cover = ''
    }

    // 实体更新 = properties 整体替换（entity_commands.rs:338），必须带全量
    const properties: Record<string, unknown> = { ...(props.book?.properties ?? {}) }
    if (!props.book && props.nextSortOrder !== undefined) properties.sortOrder = props.nextSortOrder
    if (cover !== undefined) properties.cover = cover

    if (props.book) {
      await es.update(props.book.id, { name, description: descVal.value, tags: [...tagsVal.value], properties })
    } else {
      // 创建模式：此刻才落地书籍实体
      const now = new Date().toISOString()
      await es.add({
        id: `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'book',
        name,
        description: descVal.value,
        properties,
        tags: [...tagsVal.value],
        createdAt: now,
        updatedAt: now,
      })
    }
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

/* 标签编辑器（chips + 行内输入；回车/逗号添加） */
.binfo-tags {
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  padding: 6px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-xs);
  background: var(--input-bg); transition: border-color 0.15s;
}
.binfo-tags:focus-within { border-color: var(--primary); }
.binfo-tag {
  display: inline-flex; align-items: center; gap: 2px;
  font-size: var(--font-size-xs); color: var(--text-secondary);
  background: var(--bg-tertiary); padding: 2px 4px 2px 8px; border-radius: var(--radius-2xs);
}
.binfo-tag-x {
  width: 16px; height: 16px; padding: 0; border: none; border-radius: var(--radius-2xs);
  background: transparent; color: var(--text-tertiary); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: color 0.15s, background 0.15s;
}
.binfo-tag-x:hover { color: var(--danger); background: var(--hover-bg); }
.binfo-tag-input {
  flex: 1; min-width: 100px; border: none; background: transparent; outline: none;
  font-size: var(--font-size-xs); color: var(--text-color); padding: 2px 0;
}
.binfo-tag-input::placeholder { color: var(--text-tertiary); }

.binfo-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
