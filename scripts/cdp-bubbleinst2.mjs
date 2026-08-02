// 通过注释节点 __vnode.component 读真实 AgentMessageBubble 实例
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
      const found = [];
      if (scrollEl) {
        Array.from(scrollEl.childNodes).forEach((node) => {
          const vn = node.__vnode;
          if (!vn) return;
          const comp = vn.component;
          const nm = comp && comp.type && (comp.type.name || comp.type.__name) || '';
          if (nm.includes('MessageBubble') && comp.setupState) {
            const s = comp.setupState;
            const hvc = s.hasVisibleContent && 'value' in s.hasVisibleContent ? s.hasVisibleContent.value : s.hasVisibleContent;
            const msg = s.props && s.props.msg;
            found.push({
              name: nm,
              nodeType: node.nodeType,
              hasVisibleContent: hvc,
              isDivider: !!(s.props && s.props.isDivider),
              role: msg && msg.role,
              msgContent: msg ? String(msg.content || '').slice(0, 30) : 'NO_MSG',
              msgThinking: msg ? String(msg.thinking || '').slice(0, 15) : '',
            });
          }
        });
      }
      out.bubbles = found;
      // 也读一下 props.msg 的完整字段
      const asst = found.find(f => f.role === 'assistant');
      return JSON.stringify(out);
    })()
  `
  console.log(await evalJs(probe))
  ws.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
