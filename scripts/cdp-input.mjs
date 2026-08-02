// 查找 ChatInput 发送按钮 + 输入框绑定
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
      const ta = document.querySelector('textarea.chat-textarea');
      if (!ta) return 'NO_TEXTAREA';
      // 输入框所在容器，找按钮
      let container = ta.closest('.chat-input, [class*=input], [class*=composer]') || ta.parentElement;
      const btns = container ? Array.from(container.querySelectorAll('button')).map(b => ({
        cls: b.className.slice(0, 60),
        text: (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 20),
        disabled: b.disabled,
      })) : [];
      // 组件 setupState 里的关键字段
      let comp = ta.__vueParentComponent;
      const chain = [];
      const stateKeys = {};
      while (comp) {
        const nm = (comp.type && (comp.type.name || comp.type.__name)) || 'anon';
        chain.push(nm);
        if (nm === 'ChatInput') {
          const s = comp.setupState || {};
          stateKeys.chatInput = Object.keys(s).slice(0, 40);
          // 输入框 v-model 值源
          for (const k of Object.keys(s)) {
            const v = s[k];
            if (v && typeof v === 'object' && 'value' in v && typeof v.value === 'string') {
              stateKeys.chatInputText = stateKeys.chatInputText || [];
              stateKeys.chatInputText.push(k + '=' + JSON.stringify(v.value.slice(0, 20)));
            }
          }
        }
        if (nm === 'SpaceChat') {
          const s = comp.setupState || {};
          const msgs = s.messages && s.messages.value;
          stateKeys.spaceMsgs = msgs ? msgs.length : 'NA';
        }
        comp = comp.parent;
      }
      return JSON.stringify({ chain: chain.slice(0, 6), btns, stateKeys });
    })()
  `
  console.log(await evalJs(probe))
  ws.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
