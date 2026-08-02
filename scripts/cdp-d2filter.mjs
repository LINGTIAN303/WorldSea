// 读 D2 日志中非 [RustAgent] 的行（WARN/ERR/其他）
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
  const logs = await evalJs(`JSON.stringify((window.__D2 && window.__D2.logs || []).filter(l => !l.startsWith('LOG:[RustAgent]') && !l.startsWith('LOG:[LongTaskRust]')))`)
  try {
    const arr = JSON.parse(logs)
    console.log('非事件日志条数:', arr.length)
    arr.forEach(l => console.log(l))
  } catch { console.log(logs) }
  ws.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
