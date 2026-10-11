/**
 * pdfjs-dist 运行时初始化（模块级单例）
 *
 * 背景：pdfjs 默认 `workerSrc = ''` 会回退到**主线程同步解析** —— 大 PDF 直接卡死 UI
 * （2026-09-06 已在 `useFileExtract` 踩过）。正解是显式创建 module Worker 并挂到
 * `GlobalWorkerOptions.workerPort`。
 *
 * 该设置是**全局单例**，且两条链路都需要它 ——「文件预览」（PdfPreview）与
 * 「Agent 附件提取」（useFileExtract）—— 故统一在此初始化，避免两份拷贝：
 * 先到者完成初始化，后到者直接复用（并发调用共享同一 Promise）。
 */
import type * as PdfjsModule from 'pdfjs-dist'

type Pdfjs = typeof PdfjsModule

let initPromise: Promise<Pdfjs> | null = null

/** 取已完成 Worker 初始化的 pdfjs 模块 */
export function ensurePdfWorker(): Promise<Pdfjs> {
  if (!initPromise) {
    initPromise = (async () => {
      const pdfjsLib = await import('pdfjs-dist')
      if (!pdfjsLib.GlobalWorkerOptions.workerPort) {
        pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(
          new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url),
          { type: 'module' },
        )
      }
      return pdfjsLib
    })()
  }
  return initPromise
}
