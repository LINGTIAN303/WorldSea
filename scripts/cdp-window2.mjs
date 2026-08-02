// 宽泛探查：chat-messages 元素与组件链
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
      const els = Array.from(document.querySelectorAll('.chat-messages'));
      out.chatMessagesCount = els.length;
      out.details = els.map((el, i) => {
        const chain = [];
        let c = el.__vueParentComponent;
        for (let k = 0; k < 8 && c; k++) {
          chain.push((c.type && (c.type.name || c.type.__name)) || 'anon');
          c = c.parent;
        }
        return { i, text: (el.innerText || '').slice(0, 80), chain: chain.join('>') };
      });
      // 直接找 AgentMessageList 组件实例（遍历挂载树）
      const root = document.querySelector('#app').__vue_app__;
      let aml = null;
      const walk = (c) => {
        if (aml) return;
        if (c && c.component) {
          const nm = (c.component.type && (c.component.type.name || c.component.type.__name)) || '';
          if (nm.includes('MessageList')) { aml = c.component; return; }
          if (c.component.subTree) {
            const visit = (vnode) => {
              if (aml || !vnode) return;
              if (vnode.component) {
                const n2 = (vnode.component.type && (vnode.component.type.name || vnode.component.type.__name)) || '';
                if (n2.includes('MessageList')) { aml = vnode.component; return; }
                walk(vnode.component);
              }
              if (vnode.children && typeof vnode.children === 'object') {
                Object.values(vnode.children).forEach((ch) => { if (typeof ch === 'object' && ch && !aml) { visit(ch); } });
                if (Array.isArray(vnode.children)) vnode.children.forEach(visit);
              }
            };
            visit(c.component.subTree);
          }
        }
      };
      // 简单方式：从 body 找所有带 __vnode 的组件有点复杂，改为从 SpaceChat 的 setupState 找
      const ta = document.querySelector('textarea.chat-textarea');
      let comp = ta ? ta.__vueParentComponent : null;
      while (comp) {
        if (comp.setupState && typeof comp.setupState.sendMessage === 'function') break;
        comp = comp.parent;
      }
      if (comp && comp.setupState) {
        const s = comp.setupState;
        out.spaceStateKeys = Object.keys(s).filter(k => /message|Message/.test(k));
      }
      return JSON.stringify(out);
    })()
  `
  console.log(await evalJs(probe))
  ws.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
