// 深度遍历 Vue 组件树，收集所有 AgentMessageBubble / NormalMessageBubble 实例
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
      const out = [];
      const app = document.querySelector('#app') && document.querySelector('#app').__vue_app__;
      if (!app) return 'NO_VUE_APP';
      const seen = new Set();
      const collect = (comp, depth) => {
        if (!comp || seen.has(comp)) return;
        seen.add(comp);
        const type = comp.type;
        const nm = (type && (type.name || type.__name)) || (typeof type === 'object' && type.__name) || '';
        if (nm.includes('MessageBubble') || nm === 'AgentMessageList') {
          const s = comp.setupState || {};
          const read = (k) => { const v = s[k]; return v && typeof v === 'object' && 'value' in v ? v.value : v };
          if (nm === 'AgentMessageBubble') {
            const msg = read('props') && read('props').msg;
            out.push({
              nm, depth,
              hasVisibleContent: read('hasVisibleContent'),
              role: msg && msg.role,
              content: msg ? String(msg.content || '').slice(0, 25) : 'NO_MSG',
            });
          } else if (nm === 'NormalMessageBubble') {
            const msg = read('props') && read('props').msg;
            out.push({ nm, depth, role: msg && msg.role, content: msg ? String(msg.content || '').slice(0, 25) : 'NO_MSG' });
          } else {
            const msgs = read('props') && read('props').messages;
            out.push({ nm, depth, propsLen: msgs ? msgs.length : 'NA', windowItems: (read('windowedDisplayItems') || {items:[]}).items.length });
          }
        }
        if (comp.subTree) {
          const walkVn = (vn, d) => {
            if (!vn) return;
            if (vn.component) collect(vn.component, d);
            if (vn.dynamicChildren) vn.dynamicChildren.forEach(c => walkVn(c, d + 1));
            if (Array.isArray(vn.children)) vn.children.forEach(c => walkVn(c, d + 1));
            else if (vn.children && typeof vn.children === 'object') {
              Object.values(vn.children).forEach(c => { if (c && typeof c === 'object' && c.type) walkVn(c, d + 1); });
            }
          };
          walkVn(comp.subTree, depth + 1);
        }
      };
      collect(app._instance, 0);
      return JSON.stringify(out);
    })()
  `
  console.log(await evalJs(probe))
  ws.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
