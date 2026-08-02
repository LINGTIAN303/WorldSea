// 查 childNodes（含注释节点）+ 遍历 AgentMessageBubble 实例的 hasVisibleContent
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
      if (scrollEl) {
        out.childNodes = Array.from(scrollEl.childNodes).map(n => n.nodeType === 1 ? ('E:' + (n.className||'').toString().slice(0,40)) : ('C:' + n.nodeType + (n.nodeType===8?':comment':'')));
      }
      // 遍历 AgentMessageBubble 组件实例
      const bubbles = [];
      const rootApp = document.querySelector('#app').__vue_app__;
      const visit = (comp) => {
        if (!comp || !comp.component) return;
        const nm = (comp.component.type && (comp.component.type.name || comp.component.type.__name)) || '';
        if (nm === 'AgentMessageBubble' && comp.component.setupState) {
          const s = comp.component.setupState;
          const hvc = s.hasVisibleContent && typeof s.hasVisibleContent === 'object' && 'value' in s ? s.hasVisibleContent.value : s.hasVisibleContent;
          const msg = s.props && s.props.msg;
          bubbles.push({ hasVisibleContent: hvc, role: msg && msg.role, contentSample: msg && msg.content ? String(msg.content).slice(0,20) : '' });
        }
        if (comp.component.subTree) {
          const walkVnode = (vn) => {
            if (!vn) return;
            if (vn.component) visit(vn.component);
            if (Array.isArray(vn.children)) vn.children.forEach(walkVnode);
            else if (vn.children && typeof vn.children === 'object') Object.values(vn.children).forEach(c => { if (c && typeof c === 'object') walkVnode(c); });
          };
          walkVnode(comp.component.subTree);
        }
        if (comp.children && Array.isArray(comp.children)) comp.children.forEach(visit);
      };
      visit(rootApp);
      out.bubbles = bubbles;
      return JSON.stringify(out);
    })()
  `
  console.log(await evalJs(probe))
  ws.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
