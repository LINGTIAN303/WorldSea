// 同刻快照：props.messages + windowedDisplayItems + DOM 三者对比
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
      const el = document.querySelectorAll('.chat-messages')[1];
      let comp = el ? el.__vueParentComponent : null;
      while (comp) {
        const nm = (comp.type && (comp.type.name || comp.type.__name)) || 'anon';
        if (nm === 'AgentMessageList' && comp.setupState) break;
        comp = comp.parent;
      }
      if (!comp) return 'NO_AML';
      const s = comp.setupState;
      const read = (k) => { const v = s[k]; return v && typeof v === 'object' && 'value' in v ? v.value : v };
      const propsMsgs = read('props').messages || [];
      const wdi = read('windowedDisplayItems') || { items: [] };
      const scrollEl = document.querySelectorAll('.messages-scroll')[0];
      const domChildren = scrollEl ? Array.from(scrollEl.children).map(ch => (ch.className || '').toString().slice(0, 40)) : [];
      return JSON.stringify({
        propsLen: propsMsgs.length,
        propsRoles: propsMsgs.map(m => m.role + (m.content ? ':有内容' : ':空')),
        windowItems: wdi.items.map(it => it.type + (it.msg ? ':' + it.msg.role : '')),
        topPlaceholder: wdi.topPlaceholderHeight,
        bottomPlaceholder: wdi.bottomPlaceholderHeight,
        visibleStart: read('visibleStart'),
        visibleEnd: read('visibleEnd'),
        isAtBottom: read('isAtBottom'),
        domChildren,
      });
    })()
  `
  console.log(await evalJs(probe))
  ws.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
