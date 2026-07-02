/**
 * Tauri IPC 写入缓冲器。
 * 收集写入请求到缓冲区，调用 flush() 时并发发送给后端
 * （逐个 invoke cmd_fs_write，通过 Promise.all 并发执行）。
 * 适用于短时间内有大量文件写入的场景（如项目导出）。
 */

interface PendingWrite {
  path: string
  content: string
}

export function createBatchIpc(options?: {
  maxBatchSize?: number
  autoFlushInterval?: number
}) {
  const maxBatchSize = options?.maxBatchSize ?? 50
  const autoFlushInterval = options?.autoFlushInterval ?? 0
  const pending: PendingWrite[] = []
  let autoFlushTimer: ReturnType<typeof setInterval> | null = null

  if (autoFlushInterval > 0) {
    autoFlushTimer = setInterval(() => {
      if (pending.length > 0) flush()
    }, autoFlushInterval)
  }

  async function getInvoke() {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      return invoke
    } catch {
      return null
    }
  }

  /** 添加一个待写入文件 */
  function add(path: string, content: string) {
    pending.push({ path, content })
    if (pending.length >= maxBatchSize) {
      flush()
    }
  }

  /** 刷出所有待写入文件 */
  async function flush(): Promise<void> {
    if (pending.length === 0) return
    const items = pending.splice(0)
    const invoke = await getInvoke()
    if (!invoke) {
      console.warn('[batchIpc] Tauri 环境不可用，跳过批量写入')
      return
    }
    // 并发写入：逐个 invoke cmd_fs_write，通过 Promise.all 并发执行
    // 后端无 batch 命令，使用并发调用替代串行 await 以提升吞吐
    const writes = items.map(item =>
      invoke('cmd_fs_write', { path: item.path, content: item.content, createDirs: true })
        .catch((e: any) => console.warn(`[batchIpc] 写入失败: ${item.path}`, e))
    )
    await Promise.all(writes)
  }

  /** 销毁，清理定时器 */
  function destroy() {
    if (autoFlushTimer) {
      clearInterval(autoFlushTimer)
      autoFlushTimer = null
    }
  }

  return { add, flush, destroy }
}
