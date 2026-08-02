// 查 Rust sessions + runtime messages + 迟到日志
const TARGET = 'http://localhost:9222/json/list'
async function main() {
  const list = await (await fetch(TARGET)).json()
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')
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

  // 1. 迟到日志
  const late = await evalJs(`JSON.stringify({logCount:(window.__D2&&window.__D2.logs||[]).length, last10:(window.__D2&&window.__D2.logs||[]).slice(-10)})`)
  console.log('== D2 迟到日志 ==')
  console.log(late)

  // 2. 查 Rust sessions
  const sess = await evalJs(`(async()=>{try{const s=await window.__TAURI_INTERNALS__.invoke('cmd_agent_list_sessions'); window.__sessions=s; return JSON.stringify(s)}catch(e){return 'ERR:'+String(e&&e.message||e)}})()`)
  console.log('== sessions ==')
  console.log(sess)

  // 3. 对每个 session 查 runtime messages（最近文本）
  const msgs = await evalJs(`(async()=>{
    const out = [];
    const s = window.__sessions || [];
    for (const sid of s) {
      try {
        const m = await window.__TAURI_INTERNALS__.invoke('cmd_agent_get_runtime_messages', { sessionId: sid });
        const texts = (m || []).map(x => (x && (x.content || x.text)) || '').filter(Boolean).slice(-4);
        out.push({ sid: sid.slice(0, 30), count: (m||[]).length, lastTexts: texts.map(t => String(t).slice(0, 30)) });
      } catch (e) { out.push({ sid: sid.slice(0, 30), err: String(e && e.message || e) }); }
    }
    return JSON.stringify(out);
  })()`)
  console.log('== runtime messages ==')
  console.log(msgs)

  ws.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
