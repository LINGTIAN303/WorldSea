// 查消息对象 content 的真实类型 + hasVisibleContent 计算值 + 渲染错误
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
      const el = document.querySelectorAll('.chat-messages')[1];
      let comp = el ? el.__vueParentComponent : null;
      while (comp) {
        const nm = (comp.type && (comp.type.name || comp.type.__name)) || 'anon';
        if (nm === 'AgentMessageList' && comp.setupState) break;
        comp = comp.parent;
      }
      if (!comp) return 'NO_AML';
      const s = comp.setupState;
      const props = s.props;
      const asst = props.messages.find(m => m.role === 'assistant');
      if (!asst) return 'NO_ASSISTANT_IN_PROPS';
      out.contentType = typeof asst.content;
      out.contentIsArray = Array.isArray(asst.content);
      out.contentSample = typeof asst.content === 'string' ? asst.content.slice(0, 60) : JSON.stringify(asst.content).slice(0, 80);
      out.allKeys = Object.keys(asst);
      out.thinking = typeof asst.thinking;
      out.blocks = asst.blocks ? asst.blocks.length : 0;
      out.images = asst.images ? asst.images.length : 0;
      out.files = asst.files ? asst.files.length : 0;
      out.toolCalls = asst.toolCalls ? asst.toolCalls.length : 0;
      // 尝试运行 hasVisibleContent 的等价逻辑
      try {
        const c = asst.content;
        let vis = false;
        if (asst.role === 'user') vis = true;
        else if (asst.thinking) vis = true;
        else if (asst.images && asst.images.length) vis = true;
        else if (asst.files && asst.files.length) vis = true;
        else if (asst.blocks && asst.blocks.length) vis = true;
        else if (asst.toolCalls && asst.toolCalls.length) vis = true;
        else if (c) {
          const text = String(c).trim();
          if (text && !text.startsWith('{')) vis = true;
        }
        out.hasVisibleContentByLogic = vis;
      } catch (e) { out.hasVisibleContentErr = String(e); }
      return JSON.stringify(out);
    })()
  `
  console.log(await evalJs(probe))
  ws.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
