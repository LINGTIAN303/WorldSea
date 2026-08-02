// DOM 状态探查
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
      // 聊天容器文本
      const all = document.body.innerText || '';
      out.bodySnippet = all.slice(0, 300);
      // textarea 数量与 class
      out.textareas = Array.from(document.querySelectorAll('textarea')).map(t => ({ cls: t.className.slice(0, 60), ph: t.placeholder || '' }));
      // 常见消息气泡选择器试探
      const sel = ['.message', '.bubble', '.chat-message', '[class*=msg-]', '[class*=bubble-]', '[class*=chat-item]'];
      out.hits = {};
      for (const s of sel) {
        try { out.hits[s] = document.querySelectorAll(s).length } catch { out.hits[s] = 'err' }
      }
      // 是否在 SpaceChat / AgentChat
      const ta = document.querySelector('textarea');
      let comp = ta ? ta.__vueParentComponent : null;
      const chain = [];
      while (comp) { chain.push((comp.type && (comp.type.name || comp.type.__name)) || 'anon'); comp = comp.parent; }
      out.compChain = chain.slice(0, 8).join(' > ');
      return JSON.stringify(out);
    })()
  `
  console.log(await evalJs(probe))
  ws.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
