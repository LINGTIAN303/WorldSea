// 探针：确认 useLongTaskRust.startTask 返回类型与 checkpoint 行为
const TARGET = 'http://localhost:9222/json/list'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const list = await (await fetch(TARGET)).json()
  const page = list.find((t) => t.type === 'page' && /^https?:/.test(t.url))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let msgId = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    let d; try { d = JSON.parse(e.data) } catch { return }
    if (d.id != null) { const p = pending.get(d.id); if (p) { pending.delete(d.id); p(d) } }
  }
  const send = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return r.result?.result?.value ?? r.result?.result?.description ?? JSON.stringify(r.result)
  }

  const probe = await evalJs(`
    (async () => {
      const mod = await import('/apps/tauri/src/agent/composables/useLongTaskRust.ts');
      const lt = mod.useLongTaskRust();
      const ret = lt.startTask({
        type: 'main-agent',
        prompt: '探针任务',
        lastUserText: '探针任务',
        getCheckpointData: () => ({ agentMessages: [{ id: 'pm', role: 'user', content: '探针', timestamp: Date.now() }], lastUserText: '探针任务' }),
      });
      const retType = typeof ret;
      const isPromise = ret && typeof ret.then === 'function';
      const awaited = await ret;
      const awaitedType = typeof awaited;
      const awaitedIsString = typeof awaited === 'string';
      // checkpoint 验证
      lt.checkpoint(awaitedIsString ? awaited : null, { turnCount: 5, currentTool: 'probe_tool' });
      const turnAfterCk = lt.activeTask.value ? lt.activeTask.value.turnCount : 'NO_ACTIVE';
      // 清理
      if (lt.activeTask.value) await lt.completeTask(lt.activeTask.value.taskId);
      return JSON.stringify({
        retType,
        isPromise,
        awaitedType,
        awaitedIsString,
        awaitedPreview: isPromise ? String(awaited).slice(0, 60) : awaited,
        turnAfterCk,
      });
    })()
  `)
  console.log('[probe]', probe)

  ws.close()
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
