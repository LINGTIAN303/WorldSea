// 探查当前 messages 状态 + DOM 渲染
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
      // 1. 找 SpaceChat 组件的 messages
      const ta = document.querySelector('textarea.chat-textarea');
      let comp = ta ? ta.__vueParentComponent : null;
      while (comp) {
        const nm = (comp.type && (comp.type.name || comp.type.__name)) || 'anon';
        if (nm === 'SpaceChat' && comp.setupState) {
          const s = comp.setupState;
          const msgs = s.messages && (s.messages.value || s.messages);
          out.spaceMsgs = msgs ? msgs.map(m => ({ role: m.role, id: (m.id||'').slice(0,12), c: (m.content||'').slice(0,30) })) : 'NA';
          out.hasIsStreaming = !!(s.isStreaming);
          out.isStreaming = s.isStreaming ? (s.isStreaming.value ?? s.isStreaming) : null;
          break;
        }
        comp = comp.parent;
      }
      // 2. DOM 中所有文本块（消息区）
      const listEl = document.querySelector('[class*=message-list], [class*=chat-list], [class*=msg-list], [class*=conversation]');
      if (listEl) {
        out.listText = (listEl.innerText || '').slice(0, 500);
      } else {
        out.listText = 'NO_LIST_EL';
      }
      return JSON.stringify(out);
    })()
  `
  console.log(await evalJs(probe))
  ws.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
