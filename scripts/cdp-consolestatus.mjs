// 验证 console.log 是否工作 + 检查页面是否有过重载
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
  await send('Runtime.enable')
  // 1. console.log 直接测试
  console.log('probe1 console.log direct')
  const r1 = await evalJs(`(()=>{ console.log('__probe_test'); return 'logged' })()`)
  console.log('r1:', r1)
  await new Promise(r => setTimeout(r, 1000))
  const r2 = await evalJs(`JSON.stringify({d2Logs: (window.__D2&&window.__D2.logs)||'NO_D2', d2Exists: !!window.__D2})`)
  console.log('r2:', r2)
  // 2. 检查 __TAURI_INTERNALS__ 上 invoke 是否还被包裹（页面重载会丢失）
  const r3 = await evalJs(`JSON.stringify({invokeHooked: !!(window.__TAURI_INTERNALS__&&window.__TAURI_INTERNALS__.__diagInvokeHooked), origInvokeSame: !!(window.__TAURI_INTERNALS__&&window.__TAURI_INTERNALS__.invoke)})`)
  console.log('r3:', r3)
  ws.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
