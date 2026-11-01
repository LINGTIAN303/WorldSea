/**
 * 自绘文件选择器的 apps 侧实现：把 `FilePickerApi.pick()` 转成「入队 → 由 FilePickerHost 兑现」。
 *
 * 单例队列而非全局单弹窗：并发调用（例如一键批量导入同时触发多处）按 FIFO 依次弹出，
 * 不互相吞掉 Promise。Host 每次只消费队列头部，结束后 `settle()` 出队并唤醒下一个。
 *
 * 未挂载 Host（浏览器预览 / 单测 / 启动早期）时直接返回 null，与 entity-core 的 noop 口径一致。
 */

import { computed, ref } from 'vue'
import { registerFilePickerApi, type FilePickerRequest } from '@worldsea/entity-core/core'

interface PendingPick {
  id: number
  req: FilePickerRequest
  resolve: (paths: string[] | null) => void
}

const queue = ref<PendingPick[]>([])
let seq = 0

/** 当前待处理请求（Host 据此开启/更新面板）；空 = 关闭 */
export const activePick = computed<PendingPick | null>(() => queue.value[0] ?? null)

/** 入队一个选择请求，等 Host 兑现 */
function enqueue(req: FilePickerRequest): Promise<string[] | null> {
  return new Promise((resolve) => {
    queue.value = [...queue.value, { id: ++seq, req, resolve }]
  })
}

/** Host 兑现队头：出队并回填结果（传 null 表示取消） */
export function settlePick(paths: string[] | null): void {
  const head = queue.value[0]
  if (!head) return
  queue.value = queue.value.slice(1)
  head.resolve(paths)
}

/** 清空全部待处理请求（项目切换 / 窗口关闭等场景兜底，避免 Promise 悬挂） */
export function cancelAllPicks(): void {
  const pending = queue.value
  queue.value = []
  for (const item of pending) item.resolve(null)
}

/** 注册到 entity-core 注入槽（启动链调用一次） */
export function installFilePickerApi(): void {
  registerFilePickerApi({ pick: enqueue })
}
