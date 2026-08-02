// 长任务实测 Phase A：真实消息端到端（心跳 + checkpoint + 完成）
// 发送触发工具调用的消息 → 长任务启动 → 观察心跳/checkpoint → 等完成 → 查 SQLite record
const TARGET = 'http://localhost:9222/json/list'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const list = await (await fetch(TARGET)).json()
  const page = list.find((t) => t.type === 'page' && /^https?:/.test(t.url))
  if (!page) throw new Error('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  console.log('[1] ws connected')
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

  // 挂 console 日志 hook（观察 LongTaskRust 生命周期日志）
  await evalJs(`
    (() => {
      window.__LTLOGS = [];
      window.__LT_OLD_LOG = console.log.bind(console);
      console.log = function(...args) {
        try { window.__LTLOGS.push(args.map(String).join(' ')); } catch {}
        window.__LT_OLD_LOG(...args);
      };
      window.__LT_OLD_WARN = console.warn.bind(console);
      console.warn = function(...args) {
        try { window.__LTLOGS.push('WARN:' + args.map(String).join(' ')); } catch {}
        window.__LT_OLD_WARN(...args);
      };
      return 'hooked';
    })()
  `)

  // 发消息（触发工具调用的任务消息）
  const trigger = await evalJs(`
    (() => {
      const ta = document.querySelector('textarea.chat-textarea');
      if (!ta) return 'NO_TEXTAREA';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '请查询知识库中是否有关于"角色"的设定');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      let comp = ta.__vueParentComponent;
      while (comp) {
        const nm = (comp.type && (comp.type.name || comp.type.__name)) || 'anon';
        if (nm === 'ChatInput' && comp.setupState && typeof comp.setupState.onSend === 'function') break;
        comp = comp.parent;
      }
      if (!comp) return 'NO_CHATINPUT';
      comp.setupState.onSend();
      return 'sent';
    })()
  `)
  console.log('[2] trigger:', trigger)

  // 轮询观察任务状态
  let taskSeen = false
  for (let i = 0; i < 10; i++) {
    await sleep(4000)
    const st = await evalJs(`
      (async () => {
        try {
          const { useLongTaskRust } = await import('/apps/tauri/src/agent/composables/useLongTaskRust.ts');
          const lt = useLongTaskRust();
          const running = await lt.detectResumableTasks();
          return JSON.stringify({
            t: ${(i + 1) * 4},
            hasActive: lt.hasActiveTask.value,
            hb: lt.heartbeatStatus.value,
            taskId: lt.activeTask.value ? lt.activeTask.value.taskId : null,
            turnCount: lt.activeTask.value ? lt.activeTask.value.turnCount : null,
            currentTool: lt.activeTask.value ? lt.activeTask.value.currentTool : null,
            runningCount: running.length,
            running: running.map((r) => ({ id: r.taskId.slice(-12), status: r.status, turn: r.turnCount })),
          });
        } catch (e) {
          return 'ERR:' + String(e && e.message || e);
        }
      })()
    `)
    console.log(`[t+${(i + 1) * 4}s]`, st)
    if (!taskSeen && !JSON.stringify(st).includes('hasActive:false')) taskSeen = true
    if (JSON.stringify(st).includes('hasActive:false') && taskSeen) break
  }

  // 等完成（最长再等 30s）
  console.log('[3] 等待任务完成...')
  let finalState = null
  for (let i = 0; i < 8; i++) {
    await sleep(4000)
    finalState = await evalJs(`
      (async () => {
        try {
          const { useLongTaskRust } = await import('/apps/tauri/src/agent/composables/useLongTaskRust.ts');
          const lt = useLongTaskRust();
          const running = await lt.detectResumableTasks();
          if (lt.hasActiveTask.value) {
            return JSON.stringify({ done: false, turn: lt.activeTask.value.turnCount, tool: lt.activeTask.value.currentTool });
          }
          return JSON.stringify({ done: true, runningCount: running.length });
        } catch (e) {
          return 'ERR:' + String(e && e.message || e);
        }
      })()
    `)
    if (JSON.stringify(finalState).includes('"done":true')) break
  }
  console.log('[4] 终态:', finalState)

  // 查 SQLite 里的任务记录（list_all 看终态 + 心跳时间）
  const records = await evalJs(`
    (async () => {
      try {
        const T = window.__TAURI_INTERNALS__;
        const all = await T.invoke('cmd_long_task_list_all');
        return JSON.stringify(all.map((r) => ({
          id: r.taskId.slice(-12),
          type: r.type,
          status: r.status,
          turnCount: r.turnCount,
          startedAt: r.startedAt,
          lastHeartbeatAt: r.lastHeartbeatAt,
          endedAt: r.endedAt || null,
          checkpointAgentMessages: r.checkpoint ? (r.checkpoint.agentMessages || []).length : 0,
          metaPrompt: r.meta ? r.meta.prompt : '',
        })));
      } catch (e) {
        return 'ERR:' + String(e && e.message || e);
      }
    })()
  `)
  console.log('[5] SQLite 任务记录:', records)

  // 日志摘要
  const logs = await evalJs(`JSON.stringify((window.__LTLOGS || []).filter((l) => l.includes('LongTaskRust')).slice(-8))`)
  console.log('[6] LongTaskRust 日志:', logs)

  ws.close()
  console.log('[DONE]')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
