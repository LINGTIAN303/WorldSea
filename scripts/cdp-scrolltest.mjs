// 测试：触发滚动/强制更新后 DOM 是否渲染 assistant 气泡
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
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return r.result?.result?.value ?? r.result?.result?.description ?? JSON.stringify(r.result)
  }

  const before = await evalJs(`JSON.stringify(Array.from(document.querySelectorAll('.messages-scroll')[0].children).map(ch => (ch.className||'').toString().slice(0,40)))`)
  console.log('before:', before)

  // 触发滚动事件
  await evalJs(`(()=>{const el=document.querySelectorAll('.messages-scroll')[0]; el.dispatchEvent(new Event('scroll')); el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); return 'scrolled'})()`)
  await sleep(500)
  const after1 = await evalJs(`JSON.stringify(Array.from(document.querySelectorAll('.messages-scroll')[0].children).map(ch => (ch.className||'').toString().slice(0,40)))`)
  console.log('after scroll:', after1)

  // 强制触发一次窗口重建（nextTick + rAF 后）
  await sleep(200)
  const after2 = await evalJs(`JSON.stringify(Array.from(document.querySelectorAll('.messages-scroll')[0].children).map(ch => (ch.className||'').toString().slice(0,40)))`)
  console.log('after wait:', after2)

  // 读 body 全文搜索 assistant 文本
  const hasText = await evalJs(`document.body.innerText.includes('世界构建助手')`)
  console.log('hasText:', hasText)
  ws.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
