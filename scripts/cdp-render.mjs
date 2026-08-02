// 查 DOM 是否渲染了 assistant 消息 + 消息列表组件结构
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
      // 全页面文本是否包含回复内容
      out.bodyHasReply = (document.body.innerText || '').includes('我看到你的消息是空的');
      // 找包含回复文本的元素
      const all = Array.from(document.querySelectorAll('div,span,p'));
      const withText = all.filter(el => (el.innerText||'').includes('消息是空的')).slice(0,3).map(el => ({ tag: el.tagName, cls: (el.className||'').slice(0,60), parentCls: (el.parentElement&&el.parentElement.className||'').slice(0,60) }));
      out.withText = withText;
      // 消息列表相关类名
      const clsCount = {};
      document.querySelectorAll('[class*="message"]').forEach(el => { const c = String(el.className).split(' ')[0]; clsCount[c] = (clsCount[c]||0)+1 });
      out.messageCls = clsCount;
      // 渲染的消息角色标记
      out.roles = {};
      document.querySelectorAll('[class*="assistant"], [class*="user-"], [class*="user_"], [class*="bubble"]').forEach(el => {
        const c = String(el.className).split(' ').filter(x=>x).slice(0,2).join(' ');
        out.roles[c] = (out.roles[c]||0)+1;
      });
      // 可见消息文本块（body 后 600 字符）
      out.bodyTail = (document.body.innerText||'').slice(-600);
      return JSON.stringify(out);
    })()
  `
  console.log(await evalJs(probe))
  ws.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
