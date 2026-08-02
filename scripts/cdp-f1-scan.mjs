// 模拟 F1 唤起 AgentChat，再扫描组件树找 openTerminal
const TARGET = 'http://localhost:9222/json/list'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

  // 派发 F1 按键（keydown + keyup）
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F1', code: 'F1', windowsVirtualKeyCode: 112, nativeVirtualKeyCode: 112 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F1', code: 'F1', windowsVirtualKeyCode: 112, nativeVirtualKeyCode: 112 })
  console.log('[1] F1 dispatched')
  await sleep(800)

  // 直接找 document 上是否出现 agent-panel
  const dom = await evalJs(`
    (() => {
      const panel = document.querySelector('.agent-panel.agent-chat');
      return JSON.stringify({ panelFound: !!panel, panelCls: panel ? panel.className : '' });
    })()
  `)
  console.log('[2] agent panel:', dom)

  // 扫描组件树（从 App 根），找含 openTerminal 的 setupState
  const scan = await evalJs(`
    (() => {
      const results = [];
      const seen = new Set();
      const walk = (comp, depth) => {
        if (!comp || seen.has(comp) || depth > 30) return;
        seen.add(comp);
        const nm = (comp.type && (comp.type.name || comp.type.__name)) || 'anon';
        if (comp.setupState) {
          const s = comp.setupState;
          if (typeof s.openTerminal === 'function' && typeof s.writePtyInput === 'function') {
            results.push({ name: nm, depth, hasClose: typeof s.closeTerminal === 'function' });
          }
        }
        if (comp.subTree) {
          const scanV = (v, d) => {
            if (!v) return;
            if (v.component) walk(v.component, d + 1);
            const children = v.children;
            if (Array.isArray(children)) children.forEach((c) => scanV(c, d));
            if (v.dynamicChildren) v.dynamicChildren.forEach((c) => scanV(c, d));
            if (v.component && v.component.subTree) scanV(v.component.subTree, d + 1);
          };
          scanV(comp.subTree, depth);
        }
        if (comp.parent) walk(comp.parent, depth);
      };
      // 从所有已挂载组件出发（遍历所有根）
      const roots = document.querySelectorAll('*');
      let start = null;
      for (const el of roots) {
        if (el.__vueParentComponent) { start = el.__vueParentComponent; break; }
      }
      if (start) {
        // 先走到顶层
        let top = start;
        while (top.parent) top = top.parent;
        walk(top, 0);
      }
      return JSON.stringify(results);
    })()
  `)
  console.log('[3] scan:', scan)

  ws.close()
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
