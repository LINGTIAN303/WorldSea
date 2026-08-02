// CDP 终端实测：openTerminal → cmd_pty_spawn → writePtyInput → pty-output 渲染 → closeTerminal
// 通过 Vue 组件树找 AgentChat setupState 的 openTerminal/writePtyInput/closeTerminal 真实链路
const TARGET = 'http://localhost:9222/json/list'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const list = await (await fetch(TARGET)).json()
  const page = list.find((t) => t.type === 'page' && /^https?:/.test(t.url))
  if (!page) throw new Error('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  console.log('[1] ws connected')
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

  // 收集 pty-output 事件日志
  await evalJs(`
    (() => {
      if (window.__PTYLOGS) return 'existing-' + window.__PTYLOGS.length;
      window.__PTYLOGS = [];
      const orig = window.__TAURI_INTERNALS__.transformCallback;
      // 挂 Tauri event listen 的原始注册（plugin:event|listen）
      return 'hook-not-applied';
    })()
  `)

  // 找 AgentChat 组件的 setupState（含 openTerminal/writePtyInput/closeTerminal）
  const findChat = `
    (() => {
      const targets = {};
      const walk = (comp) => {
        const nm = (comp.type && (comp.type.name || comp.type.__name)) || 'anon';
        if ((nm === 'AgentChat' || nm === 'SpaceChat') && comp.setupState &&
            typeof comp.setupState.openTerminal === 'function') {
          targets[nm] = comp.setupState;
        }
        (comp.subTree && comp.subTree.component ? [comp.subTree.component] : (comp.subTree && comp.subTree.dynamicChildren ? comp.subTree.dynamicChildren.map(c=>c.component) : []))
          .forEach(walk);
        if (comp.subTree) {
          // 递归子组件树
          const stack = comp.subTree.children;
          const scan = (vnode) => {
            if (!vnode) return;
            if (vnode.component) { walk(vnode.component); }
            if (Array.isArray(vnode.children)) vnode.children.forEach(scan);
            if (vnode.dynamicChildren) vnode.dynamicChildren.forEach(scan);
            if (vnode.component && vnode.component.subTree) scan(vnode.component.subTree);
          };
          if (Array.isArray(stack)) stack.forEach(scan);
          else scan(stack);
        }
      };
      walk(window.__VUE_DEVTOOLS_GLOBAL_HOOK__ ? null : null);
      return Object.keys(targets);
    })()
  `
  // 用更简单的方式：从 document 找 textarea 的 __vueParentComponent 向上找
  const findViaTextarea = `
    (() => {
      const ta = document.querySelector('textarea.chat-textarea');
      let comp = ta ? ta.__vueParentComponent : null;
      const chain = [];
      while (comp) {
        const nm = (comp.type && (comp.type.name || comp.type.__name)) || 'anon';
        chain.push(nm);
        if (comp.setupState && typeof comp.setupState.openTerminal === 'function' &&
            comp.setupState.writePtyInput && comp.setupState.closeTerminal) {
          return JSON.stringify({ found: nm, chain: chain.slice(0, 5).join('>') });
        }
        comp = comp.parent;
      }
      return JSON.stringify({ found: 'NONE', chain: chain.slice(0, 5).join('>') });
    })()
  `
  const found = JSON.parse(await evalJs(findViaTextarea))
  console.log('[2] find:', found)
  if (found.found === 'NONE') {
    // 兜底：SpaceChat 组件树扫描
    const alt = await evalJs(`
      (() => {
        const results = [];
        const seen = new Set();
        const walk = (comp) => {
          if (!comp || seen.has(comp)) return;
          seen.add(comp);
          const nm = (comp.type && (comp.type.name || comp.type.__name)) || 'anon';
          if (comp.setupState && typeof comp.setupState.openTerminal === 'function') {
            results.push(nm);
          }
          if (comp.subTree) {
            const scan = (v) => {
              if (!v) return;
              if (v.component) walk(v.component);
              if (Array.isArray(v.children)) v.children.forEach(scan);
              if (v.dynamicChildren) v.dynamicChildren.forEach(scan);
            };
            scan(comp.subTree);
          }
        };
        if (document.querySelector('textarea.chat-textarea')) {
          walk(document.querySelector('textarea.chat-textarea').__vueParentComponent);
        }
        return JSON.stringify(results);
      })()
    `)
    console.log('[2b] alt scan:', alt)
    if (alt === '[]' || alt === '"[]"') {
      console.log('FATAL: 找不到含 openTerminal 的组件，终止')
      process.exit(1)
    }
  }

  // 1. openTerminal
  const openRes = await evalJs(`
    (() => {
      const ta = document.querySelector('textarea.chat-textarea');
      let comp = ta ? ta.__vueParentComponent : null;
      while (comp) {
        const nm = (comp.type && (comp.type.name || comp.type.__name)) || 'anon';
        if (comp.setupState && typeof comp.setupState.openTerminal === 'function' &&
            comp.setupState.writePtyInput && comp.setupState.closeTerminal) {
          window.__TERM_CHAT = comp.setupState;
          return 'found:' + nm;
        }
        comp = comp.parent;
      }
      return 'NONE';
    })()
  `)
  console.log('[3] bind:', openRes)
  if (openRes !== 'found:AgentChat' && openRes !== 'found:SpaceChat') {
    console.log('FATAL: 绑定失败', openRes)
    process.exit(1)
  }

  await evalJs(`window.__TERM_CHAT.openTerminal()`)
  console.log('[4] openTerminal 已调用')
  await sleep(1500)
  const stateAfterOpen = await evalJs(`
    JSON.stringify({
      ptyId: window.__TERM_CHAT.ptyId ? window.__TERM_CHAT.ptyId.value : 'NO_REF',
      ptyReady: window.__TERM_CHAT.ptyReady ? window.__TERM_CHAT.ptyReady.value : 'NO_REF',
      terminalVisible: window.__TERM_CHAT.terminalVisible ? window.__TERM_CHAT.terminalVisible.value : 'NO_REF',
    })
  `)
  console.log('[5] 状态 after open:', stateAfterOpen)

  // 检查 DOM xterm
  const domXterm = await evalJs(`
    (() => {
      const term = document.querySelector('.xterm');
      const panel = document.querySelector('.terminal-panel, [class*="terminal"]');
      return JSON.stringify({
        xterm: !!term,
        termText: term ? term.textContent.slice(0, 80) : '',
        panelCls: panel ? panel.className : '',
      });
    })()
  `)
  console.log('[6] DOM:', domXterm)

  // 2. writePtyInput 发命令
  await evalJs(`window.__TERM_CHAT.writePtyInput('echo hello-world-from-pty\\r')`)
  console.log('[7] writePtyInput 已发送 echo 命令')
  await sleep(2000)

  // 3. 读 xterm 内容确认输出回写
  const termAfter = await evalJs(`
    (() => {
      const term = document.querySelector('.xterm');
      return term ? term.textContent.slice(-200) : 'NO_XTERM';
    })()
  `)
  console.log('[8] 终端内容 after echo:', JSON.stringify(termAfter))

  // 4. closeTerminal
  await evalJs(`window.__TERM_CHAT.closeTerminal()`)
  await sleep(800)
  const stateAfterClose = await evalJs(`
    JSON.stringify({
      ptyId: window.__TERM_CHAT.ptyId.value,
      terminalVisible: window.__TERM_CHAT.terminalVisible.value,
    })
  `)
  console.log('[9] 状态 after close:', stateAfterClose)
  const domAfterClose = await evalJs(`!!document.querySelector('.xterm')`)
  console.log('[10] DOM xterm after close:', domAfterClose)

  ws.close()
  console.log('[DONE]')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
