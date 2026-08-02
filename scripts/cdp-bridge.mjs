// 决定性测试：注册底层 Tauri 事件监听（绕过应用层），验证 Rust→前端事件桥
const TARGET = 'http://localhost:9222/json/list'
const SESSION = 'rust_1785687895085_zqqgfy'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const list = await (await fetch(TARGET)).json()
  const page = list.find((t) => t.type === 'page')
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

  // 1. 注册原始监听
  const listenResult = await evalJs(`(async()=>{
    const T = window.__TAURI_INTERNALS__;
    window.__rawEvt = [];
    window.__listenErr = null;
    try {
      const cb = T.transformCallback((e) => {
        try { window.__rawEvt.push(JSON.stringify(e)); } catch(err) { window.__rawEvt.push('SER_ERR'); }
      });
      const r = await T.invoke('plugin:event|listen', {
        event: 'agent:event:${SESSION}',
        target: { kind: 'Any', label: null },
        handler: cb,
        options: null,
      });
      window.__listenRes = JSON.stringify(r);
      return 'listen registered: ' + window.__listenRes;
    } catch (e) {
      window.__listenErr = String(e && e.message || e);
      return 'LISTEN_ERR: ' + window.__listenErr;
    }
  })()`)
  console.log('[2] 注册监听:', listenResult)

  // 2. 用真实路径触发发送（DOM setter + onSend）
  const trigger = `
    (() => {
      const ta = document.querySelector('textarea.chat-textarea');
      if (!ta) return 'NO_TEXTAREA';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '事件桥测试');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      let comp = ta.__vueParentComponent;
      while (comp) {
        const nm = (comp.type && (comp.type.name || comp.type.__name)) || 'anon';
        if (nm === 'ChatInput' && comp.setupState && typeof comp.setupState.onSend === 'function') break;
        comp = comp.parent;
      }
      if (!comp) return 'NO_CHATINPUT';
      comp.setupState.onSend();
      return 'sent';
    })()
  `
  console.log('[3] trigger:', await evalJs(trigger))

  // 3. 轮询原始事件
  const start = Date.now()
  while (Date.now() - start < 45000) {
    await sleep(4000)
    const st = await evalJs(`JSON.stringify({t:${Math.round((Date.now()-start)/1000)}, evtCount:(window.__rawEvt||[]).length, last:(window.__rawEvt||[]).slice(-1)[0]||null, listenErr: window.__listenErr||null})`)
    console.log(`[t+${Math.round((Date.now()-start)/1000)}s]`, st)
    /* no-op */
  }

  console.log('===== 收到的原始事件 =====')
  const evts = await evalJs(`JSON.stringify(window.__rawEvt || [])`)
  try {
    const arr = JSON.parse(evts)
    if (!arr.length) console.log('(空)')
    arr.forEach((l) => console.log(l))
  } catch { console.log(evts) }

  const dom = await evalJs(`(()=>{const b=document.body.innerText||'';return JSON.stringify({tail:b.slice(-300)})})()`)
  console.log('===== DOM 尾部 =====')
  console.log(dom)
  ws.close()
  console.log('[DONE]')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
