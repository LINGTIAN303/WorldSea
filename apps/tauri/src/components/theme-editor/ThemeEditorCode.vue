<template>
  <div class="theme-code">
    <div class="theme-code__toolbar">
      <span class="theme-code__hint">JSON 格式编辑主题令牌</span>
      <div class="theme-code__actions">
        <button class="theme-code__btn" @click="importFromClipboard">粘贴导入</button>
        <button class="theme-code__btn" @click="exportToClipboard">复制导出</button>
      </div>
    </div>

    <div class="theme-code__editor-wrap">
      <textarea
        class="theme-code__editor"
        v-model="jsonText"
        spellcheck="false"
        @input="onJsonInput"
      ></textarea>
    </div>

    <div v-if="validationMsg" :class="['theme-code__validation', validationType]">
      {{ validationMsg }}
    </div>

    <div class="theme-code__section">
      <div class="theme-code__section-header">
        <span class="theme-code__section-title">CSS 注入</span>
        <span class="theme-code__section-hint">自定义 CSS 将注入到 :root</span>
      </div>
      <textarea
        class="theme-code__css-editor"
        v-model="cssText"
        spellcheck="false"
        placeholder="/* 在此输入自定义 CSS */&#10;:root {&#10;  --my-custom-var: #ff0;&#10;}"
        @input="onCssInput"
      ></textarea>
    </div>

    <div class="theme-code__apply-row">
      <button class="theme-code__apply-btn" @click="applyJson">应用 JSON</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useTheme } from '@/composables/useTheme'
import type { ThemeDefinition } from '@/composables/useTheme'

const { userOverrides, setUserOverrides, exportTheme, allThemes, currentThemeId } = useTheme()

const jsonText = ref('')
const cssText = ref('')
const validationMsg = ref('')
const validationType = ref<'error' | 'success' | 'info'>('info')

// 自定义 CSS 持久化键（2026-09-13 修复：此前只写 DOM style 标签，刷新即丢）
const CUSTOM_CSS_KEY = 'worldsea:custom-css'

onMounted(() => {
  const overrides = { ...userOverrides.value }
  if (Object.keys(overrides).length > 0) {
    jsonText.value = JSON.stringify(overrides, null, 2)
  } else {
    jsonText.value = '{\n  "--radius-md": "8px"\n}'
  }

  // 恢复持久化的自定义 CSS（无则保持空，不注入）
  let saved = ''
  try {
    saved = localStorage.getItem(CUSTOM_CSS_KEY) ?? ''
  } catch {
    saved = ''
  }
  if (saved) {
    cssText.value = saved
    applyCssToDom(saved)
  } else {
    const style = document.getElementById('ws-custom-css')
    if (style) {
      cssText.value = style.textContent ?? ''
    }
  }
})

function onJsonInput() {
  validationMsg.value = ''
}

function validateJson(text: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      validationMsg.value = 'JSON 必须是对象格式 { "--token": "value" }'
      validationType.value = 'error'
      return null
    }
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val !== 'string') {
        validationMsg.value = `令牌 "${key}" 的值必须是字符串`
        validationType.value = 'error'
        return null
      }
    }
    return parsed as Record<string, string>
  } catch (e) {
    validationMsg.value = `JSON 语法错误: ${(e as SyntaxError).message}`
    validationType.value = 'error'
    return null
  }
}

function applyJson() {
  const parsed = validateJson(jsonText.value)
  if (!parsed) return
  setUserOverrides(parsed)
  validationMsg.value = '令牌已应用'
  validationType.value = 'success'
}

/** 把自定义 CSS 写入 DOM style 标签（#ws-custom-css，注入 :root 级生效） */
function applyCssToDom(css: string) {
  let style = document.getElementById('ws-custom-css') as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = 'ws-custom-css'
    document.head.appendChild(style)
  }
  style.textContent = css
}

function onCssInput() {
  applyCssToDom(cssText.value)
  try {
    localStorage.setItem(CUSTOM_CSS_KEY, cssText.value)
  } catch {
    // localStorage 不可用时仅本次会话生效
  }
}

async function importFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    const parsed = validateJson(text)
    if (parsed) {
      jsonText.value = JSON.stringify(parsed, null, 2)
      validationMsg.value = '已从剪贴板导入'
      validationType.value = 'success'
    }
  } catch {
    validationMsg.value = '无法读取剪贴板'
    validationType.value = 'error'
  }
}

async function exportToClipboard() {
  try {
    const currentTheme = allThemes.value.find(t => t.id === currentThemeId.value)
    // 收束后自定义主题不再携带 mode（明暗独立于主题风味，导入方也不消费该字段）
    const themeDef: ThemeDefinition = {
      name: currentTheme?.name ?? '自定义主题',
      id: `custom-${Date.now()}`,
      author: 'User',
      version: '1.0.0',
      tokens: { ...userOverrides.value },
    }
    const json = exportTheme(themeDef)
    await navigator.clipboard.writeText(json)
    validationMsg.value = '已复制到剪贴板'
    validationType.value = 'success'
  } catch {
    validationMsg.value = '无法写入剪贴板'
    validationType.value = 'error'
  }
}
</script>

<style scoped>
.theme-code { display: flex; flex-direction: column; gap: var(--space-3); }
.theme-code__toolbar { display: flex; justify-content: space-between; align-items: center; }
.theme-code__hint { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
.theme-code__actions { display: flex; gap: var(--space-2); }
.theme-code__btn {
  padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  background: transparent; color: var(--color-text-secondary); font-size: var(--font-size-xs); cursor: pointer;
  transition: background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default), opacity var(--duration-fast) var(--ease-default), filter var(--duration-fast) var(--ease-default);
}
.theme-code__btn:hover { border-color: var(--color-primary); color: var(--color-primary); }

.theme-code__editor-wrap { }
.theme-code__editor {
  width: 100%; min-height: 180px; padding: var(--space-3); border: 1px solid var(--color-border);
  border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text-primary);
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; font-size: var(--font-size-xs);
  line-height: 1.6; resize: vertical; outline: none;
  transition: border-color var(--duration-fast) var(--ease-default);
}
.theme-code__editor:focus { border-color: var(--color-primary); }

.theme-code__validation {
  padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); font-size: var(--font-size-xs);
}
.theme-code__validation.error { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent); }
.theme-code__validation.success { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); border: 1px solid color-mix(in srgb, var(--success) 30%, transparent); }
.theme-code__validation.info { background: color-mix(in srgb, var(--info) 15%, transparent); color: var(--info); border: 1px solid color-mix(in srgb, var(--info) 30%, transparent); }

.theme-code__section { }
.theme-code__section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2); }
.theme-code__section-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
.theme-code__section-hint { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
.theme-code__css-editor {
  width: 100%; min-height: 100px; padding: var(--space-3); border: 1px solid var(--color-border);
  border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text-primary);
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; font-size: var(--font-size-xs);
  line-height: 1.6; resize: vertical; outline: none;
  transition: border-color var(--duration-fast) var(--ease-default);
}
.theme-code__css-editor:focus { border-color: var(--color-primary); }

.theme-code__apply-row { display: flex; justify-content: flex-end; }
.theme-code__apply-btn {
  padding: var(--space-2) var(--space-4); border: none; border-radius: var(--radius-sm);
  background: var(--color-primary); color: var(--color-primary-foreground, #fff);
  font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); cursor: pointer;
  transition: background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default), opacity var(--duration-fast) var(--ease-default), filter var(--duration-fast) var(--ease-default);
}
.theme-code__apply-btn:hover { filter: brightness(1.1); }
</style>
