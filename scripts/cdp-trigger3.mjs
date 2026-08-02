// CDP 深度诊断 v3：40s 长窗口观察 sendMessage 全链路（复用已安装的 D2 hook）
const TARGET = 'http://localhost:9222/json/list'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const list = await (await fetch(TARGET)).json()
  const page = list.find((t) => t.type === 'page')
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

  // 确认 hook 仍存在
  const hookOk = await evalJs(`JSON.stringify({d2: !!window.__D2, logCount: (window.__D2&&window.__D2.logs||[]).length})`)
  console.log('[2] hook state:', hookOk)

  // 触发
  const trigger = `
    (() => {
      const ta = document.querySelector('textarea.chat-textarea');
      if (!ta) return 'NO_TEXTAREA';
      let comp = ta.__vueParentComponent || null;
      while (comp) {
        if (comp.setupState && typeof comp.setupState.sendMessage === 'function') break;
        comp = comp.parent;
      }
      if (!comp) return 'NO_SENDMESSAGE';
      window.__D2.stateBefore = JSON.stringify({ messagesLen: (comp.setupState.messages.value||[]).length });
      const p = comp.setupState.sendMessage('全链路测试');
      if (p && typeof p.then === 'function') {
        p.then(() => { window.__D2.sendResolved = 'ok' }).catch((e) => { window.__D2.sendResolved = 'ERR:' + String(e && e.stack || e) });
      } else { window.__D2.sendResolved = 'sync'; }
      return 'SENT ' + window.__D2.stateBefore;
    })()
  `
  console.log('[3] trigger:', await evalJs(trigger))

  // 40s 轮询
  const start = Date.now()
  while (Date.now() - start < 40000) {
    await sleep(4000)
    const st = await evalJs(`JSON.stringify({t: ${Math.round((Date.now()-start)/1000)}, resolved: window.__D2.sendResolved||null, logCount: (window.__D2.logs||[]).length})`)
    console.log(`[t+${Math.round((Date.now()-start)/1000)}s]`, st)
  }

  console.log('===== D2 日志全文（含 INVOKE/ERR） =====')
  const raw = await evalJs(`JSON.stringify(window.__D2.logs || [])`)
  try {
    const arr = JSON.parse(raw)
    if (!arr.length) console.log('(空)')
    else arr.forEach((l) => console.log(l))
  } catch { console.log(raw) }

  const msgs = await evalJs(`(()=>{const ta=document.querySelector('textarea.chat-textarea');let c=ta&&ta.__vueParentComponent;while(c){if(c.setupState&&typeof c.setupState.sendMessage==='function')break;c=c.parent;}return JSON.stringify({len:(c&&c.setupState.messages.value||[]).length, last3:(c&&c.setupState.messages.value||[]).slice(-3).map(m=>({role:m.role, content:(m.content||'').slice(0,40), hasTool:!!m.toolCalls}))})})()`)
  console.log('===== 消息尾部 =====')
  console.log(msgs)
  ws.close()
  console.log('[DONE]')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
