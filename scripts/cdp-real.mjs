// CDP 真实路径测试：设 inputText + 调 onSend（复刻用户发送），40s 观察完整链路
const TARGET = 'http://localhost:9222/json/list'
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

  // 确保 hook 存在（不存在则重装；重装前旧日志保留）
  const ensureHook = `
    (() => {
      if (window.__D2) return 'existing-' + (window.__D2.logs||[]).length;
      window.__D2 = { logs: [], i: 0 };
      const D = window.__D2;
      D.i++;
      D._l = console.log.bind(console); D._e = console.error.bind(console); D._w = console.warn.bind(console);
      console.log = function(){ try{ D.logs.push('LOG:'+Array.prototype.map.call(arguments,String).join(' ')); }catch(e){} D._l.apply(console,arguments); };
      console.error = function(){ try{ D.logs.push('ERR:'+Array.prototype.map.call(arguments,String).join(' ')); }catch(e){} D._e.apply(console,arguments); };
      console.warn = function(){ try{ D.logs.push('WARN:'+Array.prototype.map.call(arguments,String).join(' ')); }catch(e){} D._w.apply(console,arguments); };
      const T = window.__TAURI_INTERNALS__;
      if (T && typeof T.invoke === 'function' && !T.__diagInvokeHooked) {
        const orig = T.invoke.bind(T);
        T.invoke = function(cmd, args){ try{ D.logs.push('INVOKE:'+cmd+' '+(args?JSON.stringify(args).slice(0,300):'{}')); }catch(e){} return orig(cmd,args); };
        T.__diagInvokeHooked = true;
      }
      return 'installed';
    })()
  `
  console.log('[2] hook:', await evalJs(ensureHook))

  // 真实路径触发
  const trigger = `
    (() => {
      const ta = document.querySelector('textarea.chat-textarea');
      if (!ta) return 'NO_TEXTAREA';
      let comp = ta.__vueParentComponent;
      const chain = [];
      let chatInput = null;
      while (comp) {
        const nm = (comp.type && (comp.type.name || comp.type.__name)) || 'anon';
        chain.push(nm);
        if (nm === 'ChatInput' && comp.setupState && typeof comp.setupState.onSend === 'function') { chatInput = comp; break; }
        comp = comp.parent;
      }
      if (!chatInput) return 'NO_CHATINPUT ' + chain.join('>');
      const s = chatInput.setupState;
      s.inputText.value = '真实路径测试';
      const ret = s.onSend();
      return 'SENT via ' + chain.slice(0,4).join('>') + ' inputText=' + JSON.stringify(s.inputText.value);
    })()
  `
  console.log('[3] trigger:', await evalJs(trigger))

  const start = Date.now()
  while (Date.now() - start < 40000) {
    await sleep(4000)
    const st = await evalJs(`JSON.stringify({t:${Math.round((Date.now()-start)/1000)}, logCount:(window.__D2.logs||[]).length})`)
    console.log(`[t+${Math.round((Date.now()-start)/1000)}s]`, st)
  }

  console.log('===== 完整日志 =====')
  const raw = await evalJs(`JSON.stringify(window.__D2.logs || [])`)
  try {
    const arr = JSON.parse(raw)
    if (!arr.length) console.log('(空)')
    else arr.forEach((l) => console.log(l))
  } catch { console.log(raw) }

  // DOM 尾部检查
  const dom = await evalJs(`(()=>{const b=document.body.innerText||'';return JSON.stringify({tail:b.slice(-400)})})()`)
  console.log('===== DOM 尾部 =====')
  console.log(dom)
  ws.close()
  console.log('[DONE]')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
