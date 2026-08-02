// 探查 AgentMessageList 渲染链：props → filteredMessages → fullDisplayItems → windowedDisplayItems
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
      // 第二个 .chat-messages 属于 AgentMessageList
      const el = document.querySelectorAll('.chat-messages')[1] || document.querySelector('.messages-scroll');
      let comp = el ? el.__vueParentComponent : null;
      while (comp) {
        const nm = (comp.type && (comp.type.name || comp.type.__name)) || 'anon';
        if (nm === 'AgentMessageList' && comp.setupState) break;
        comp = comp.parent;
      }
      if (!comp) return 'NO_AGENT_MESSAGE_LIST';
      const s = comp.setupState;
      const read = (k) => { const v = s[k]; return v && typeof v === 'object' && 'value' in v ? v.value : v };
      const propsMsgs = read('props').messages || [];
      out.propsLen = propsMsgs.length;
      out.propsLast = propsMsgs.slice(-2).map(m => ({ role: m.role, id: (m.id||'').slice(0,14), c: (m.content||'').slice(0,40) }));
      const fm = read('filteredMessages') || [];
      out.filteredLen = fm.length;
      const fdi = read('fullDisplayItems') || [];
      out.fullItems = fdi.slice(-3).map(it => ({ type: it.type, role: it.msg && it.msg.role, c: it.msg ? (it.msg.content||'').slice(0,30) : '' }));
      const wdi = read('windowedDisplayItems') || {};
      out.windowItems = (wdi.items || []).slice(-3).map(it => ({ type: it.type, role: it.msg && it.msg.role }));
      out.visibleStart = read('visibleStart');
      out.visibleEnd = read('visibleEnd');
      out.lastSeenLength = read('lastSeenLength');
      return JSON.stringify(out);
    })()
  `
  console.log(await evalJs(probe))
  ws.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
