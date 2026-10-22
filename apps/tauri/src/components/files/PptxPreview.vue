<!--
  PptxPreview —— PowerPoint（.pptx / .ppt）只读预览

  与同目录的 Docx/Xlsx/Pdf 三个渲染器不同：**本组件自己做 IO**，原因见下。

  为什么不能纯前端渲染：PPTX 的前端渲染方案还原度差、排版易崩（业界共识），正解是本机
  LibreOffice headless 转 PDF，再用已装的 pdfjs 渲染 —— 那台已由一期做好（`PdfPreview`）。
  因此这里的链路是：
      探测 LibreOffice → 未装则明确降级（提示 + 用系统默认程序打开）
                      → 已装则转 PDF（Rust 侧带缓存）→ 把产物当普通 PDF 读入 → 交给 PdfPreview

  状态机（每一步都要有可读反馈，禁止静默）：
      checking → converting → ready
                    ↘ unavailable（未装 LibreOffice）
                    ↘ error（转换/读取失败，可重试）

  注：转换产物落在**应用数据目录**的缓存里，不污染用户工作区；同一文件二次打开直接命中缓存。
-->
<template>
  <div class="pptx-host">
    <div v-if="state === 'checking' || state === 'converting'" class="pptx-msg">
      <WsInlineLoading size="sm" :label="state === 'checking' ? '正在检查转换能力' : '正在转换演示文稿'" />
      <span>{{ state === 'checking' ? '正在检查本机转换能力…' : '正在转换（首次打开可能需数秒）…' }}</span>
    </div>

    <div v-else-if="state === 'unavailable'" class="pptx-msg pptx-msg--col">
      <WsIcon name="warning" size="sm" />
      <p class="pptx-title">本机未检测到 LibreOffice</p>
      <p class="pptx-detail">
        应用内的演示文稿预览需要本机具备 LibreOffice（只有它提供可靠的 headless 转 PDF 能力，
        Microsoft Office / WPS 均无稳定的命令行转换接口）。装好 LibreOffice 后此预览即可用；
        也可以直接用系统默认程序打开该文件。
      </p>
      <div class="pptx-actions">
        <button class="pptx-btn primary" @click="openExternally">用系统默认程序打开</button>
      </div>
    </div>

    <div v-else-if="state === 'error'" class="pptx-msg pptx-msg--col">
      <WsIcon name="alert" size="sm" />
      <p class="pptx-title">演示文稿预览失败</p>
      <p class="pptx-detail">{{ errorText }}</p>
      <div class="pptx-actions">
        <button class="pptx-btn" @click="run">重试</button>
        <button class="pptx-btn primary" @click="openExternally">用系统默认程序打开</button>
      </div>
    </div>

    <PdfPreview v-else-if="state === 'ready' && pdfBytes" :data="pdfBytes" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { WsIcon, WsInlineLoading, toastWarn } from '@worldsea/ui-kit'
import { invoke } from '@/composables/transport'
import PdfPreview from './PdfPreview.vue'

type State = 'checking' | 'converting' | 'ready' | 'unavailable' | 'error'

const props = defineProps<{ path: string }>()

const state = ref<State>('checking')
const errorText = ref('')
const pdfBytes = ref<ArrayBuffer | null>(null)

/** 代次：路径切换 / 卸载后令在途流程失效，避免旧结果覆盖新状态 */
let runToken = 0

/** base64 → ArrayBuffer（与 FilePreview 同法：cmd_fs_read 只提供 utf-8 / base64 两种编码） */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

async function run(): Promise<void> {
  const token = ++runToken
  state.value = 'checking'
  errorText.value = ''
  pdfBytes.value = null

  try {
    // 1) 探测本机转换能力（Rust 侧进程内缓存，首次之后为纯内存读）
    const available = await invoke<boolean>('cmd_office_available')
    if (token !== runToken) return
    if (!available) {
      state.value = 'unavailable'
      return
    }

    // 2) 转换为 PDF（命中缓存则秒回），返回产物路径
    state.value = 'converting'
    const pdfPath = await invoke<string>('cmd_pptx_to_pdf', { src: props.path })
    if (token !== runToken) return
    if (!pdfPath) {
      errorText.value = '转换未产出 PDF 文件'
      state.value = 'error'
      return
    }

    // 3) 读取产物（落在应用数据目录，走既有 fs 命令），交给 PdfPreview 渲染
    const b64 = await invoke<string>('cmd_fs_read', { path: pdfPath, encoding: 'base64' })
    if (token !== runToken) return
    pdfBytes.value = base64ToArrayBuffer(b64)
    state.value = 'ready'
  } catch (e: unknown) {
    if (token !== runToken) return
    errorText.value = e instanceof Error ? e.message : String(e)
    state.value = 'error'
    console.warn('[PptxPreview] 预览流程失败:', e)
  }
}

/** 降级出口：交给系统默认关联程序打开（无内置渲染器时唯一可用的查看方式） */
async function openExternally(): Promise<void> {
  try {
    await invoke('cmd_open_in_explorer', { path: props.path })
  } catch (e: unknown) {
    toastWarn('打开失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

onMounted(run)
onBeforeUnmount(() => {
  runToken++
})
</script>

<style scoped>
.pptx-host {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.pptx-msg {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
.pptx-msg--col {
  flex-direction: column;
  gap: 6px;
}
.pptx-title {
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
}
.pptx-detail {
  margin: 0;
  max-width: 380px;
  line-height: 1.6;
}
.pptx-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.pptx-btn {
  padding: 5px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
}
.pptx-btn:hover {
  color: var(--color-text-primary);
  border-color: var(--color-text-tertiary);
}
.pptx-btn.primary {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.pptx-btn.primary:hover {
  background: var(--color-primary-muted);
}
</style>
