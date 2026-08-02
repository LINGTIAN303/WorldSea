// 探查 AgentOverlay / AgentChat 组件实例与开关方法
const TARGET = 'http://localhost:9222/json/list'

async function main() {
  const list = await (await fetch(TARGET)).json()
  const page = list.find((t) => t.type === 'page' && /^https?:/.test(t.url))
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

  // 扫描组件树，找 AgentOverlay / AgentChat / 含 openTerminal 的组件，列出 setupState 键
  const scan = await evalJs(`
    (() => {
      const results = [];
      const seen = new Set();
      const walk = (comp) => {
        if (!comp || seen.has(comp)) return;
        seen.add(comp);
        const nm = (comp.type && (comp.type.name || comp.type.__name)) || 'anon';
        if (/Agent|Chat|Overlay/.test(nm) && comp.setupState) {
          const keys = Object.keys(comp.setupState).filter(k => /visible|open|toggle|show|hide|terminal/i.test(k)).slice(0, 15);
          if (keys.length) {
            results.push({ name: nm, keys });
          }
        }
        if (comp.subTree) {
          const scanV = (v) => {
            if (!v) return;
            if (v.component) walk(v.component);
            if (Array.isArray(v.children)) v.children.forEach(scanV);
            if (v.dynamicChildren) v.dynamicChildren.forEach(scanV);
            if (v.component && v.component.subTree) scanV(v.component.subTree);
          };
          scanV(comp.subTree);
        }
      };
      const root = document.querySelector('textarea.chat-textarea');
      if (root) walk(root.__vueParentComponent);
      return JSON.stringify(results);
    })()
  `)
  console.log('components:', scan)

  ws.close()
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
