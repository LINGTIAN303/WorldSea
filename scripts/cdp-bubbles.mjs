// 数 AgentMessageList 渲染出的实际气泡 + 检查是否有渲染异常
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
  const probe = `
    (() => {
      const out = {};
      const scrollEl = document.querySelectorAll('.messages-scroll')[0];
      if (!scrollEl) return 'NO_SCROLL';
      out.scrollChildren = Array.from(scrollEl.children).map(el => ({
        tag: el.tagName,
        cls: (el.className || '').toString().slice(0, 50),
        text: (el.innerText || '').slice(0, 40),
      }));
      // 气泡类元素统计
      out.bubbleEls = document.querySelectorAll('[class*=bubble], [class*=Bubble]').length;
      out.messageEls = document.querySelectorAll('[class*=message-item], [class*=msg-item], [class*=message-bubble]').length;
      return JSON.stringify(out);
    })()
  `
  console.log(await evalJs(probe))
  ws.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
