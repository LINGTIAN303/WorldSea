// 重载页面
const TARGET = 'http://localhost:9222/json/list'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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
  await send('Page.enable')
  await send('Page.reload', { ignoreCache: true })
  console.log('reloaded')
  await sleep(6000)
  ws.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
