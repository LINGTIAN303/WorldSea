// 快速探查：__TAURI_INTERNALS__ 是否存在 + 组件 setupState 关键字段
const TARGET = 'http://localhost:9222/json/list'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
      out.hasTauri = typeof window.__TAURI_INTERNALS__ !== 'undefined';
      out.tauriKeys = window.__TAURI_INTERNALS__ ? Object.keys(window.__TAURI_INTERNALS__).slice(0, 20) : [];
      out.invokeType = window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke;
      out.invokeHooked = !!(window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.__diagInvokeHooked);
      const ta = document.querySelector('textarea.chat-textarea');
      let comp = ta ? ta.__vueParentComponent : null;
      while (comp) {
        const nm = (comp.type && (comp.type.name || comp.type.__name)) || 'anon';
        if (nm === 'SpaceChat' || nm === 'AgentChat') {
          const s = comp.setupState || {};
          const read = (k) => {
            const v = s[k];
            if (v && typeof v === 'object' && 'value' in v) return v.value;
            return v;
          };
          out.comp = nm;
          out.isInitialized = read('isInitialized');
          out.currentSessionId = read('currentSessionId');
          out.messagesLen = Array.isArray(read('messages')) ? read('messages').length : 'NA';
          out.isStreaming = read('isStreaming');
          out.activeChatMode = read('activeChatMode');
          break;
        }
        comp = comp.parent;
      }
      out.foundComp = !!out.comp;
      return JSON.stringify(out);
    })()
  `
  console.log('probe:', await evalJs(probe))
  ws.close()
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
