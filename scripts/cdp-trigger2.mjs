// CDP 深度诊断 v2：hook console(log/error/warn) + 包裹 Tauri invoke + 读取组件状态 + 直接调 sendMessage
// 用法: node scripts/cdp-trigger2.mjs
const TARGET = 'http://localhost:9222/json/list'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const list = await (await fetch(TARGET)).json()
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')
  console.log('[1] page:', page.title)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  console.log('[2] ws connected')

  let msgId = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    let data
    try { data = JSON.parse(e.data) } catch { return }
    if (data.id != null) { const p = pending.get(data.id); if (p) { pending.delete(data.id); p(data) } }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return r.result?.result?.value ?? r.result?.result?.description ?? JSON.stringify(r.result)
  }

  await send('Runtime.enable')

  // 深度 hook：log/error/warn + invoke 包裹（用唯一变量名避免重声明冲突）
  const hook = `
    (() => {
      window.__D2 = window.__D2 || { logs: [], i: 0 };
      const D = window.__D2;
      D.logs = [];
      D.i++;
      const tag = 'D' + D.i;
      D[tag + '_log'] = console.log.bind(console);
      D[tag + '_err'] = console.error.bind(console);
      D[tag + '_warn'] = console.warn.bind(console);
      console.log = function() { try { D.logs.push('LOG:' + Array.prototype.map.call(arguments, String).join(' ')); } catch(e){} D[tag + '_log'].apply(console, arguments); };
      console.error = function() { try { D.logs.push('ERR:' + Array.prototype.map.call(arguments, String).join(' ')); } catch(e){} D[tag + '_err'].apply(console, arguments); };
      console.warn = function() { try { D.logs.push('WARN:' + Array.prototype.map.call(arguments, String).join(' ')); } catch(e){} D[tag + '_warn'].apply(console, arguments); };
      const T = window.__TAURI_INTERNALS__;
      if (T && typeof T.invoke === 'function' && !T.__diagInvokeHooked) {
        const orig = T.invoke.bind(T);
        T.invoke = function(cmd, args) {
          try { D.logs.push('INVOKE:' + cmd + ' ' + (args ? JSON.stringify(args).slice(0, 400) : '{}')); } catch(e){}
          return orig(cmd, args);
        };
        T.__diagInvokeHooked = true;
      }
      return 'hooked-' + tag;
    })()
  `
  console.log('[3] hook:', await evalJs(hook))

  // 读取组件状态 + 触发
  const trigger = `
    (() => {
      const ta = document.querySelector('textarea.chat-textarea');
      if (!ta) return 'NO_TEXTAREA';
      let comp = ta.__vueParentComponent || null;
      let path = [];
      let found = null;
      while (comp) {
        path.push((comp.type && (comp.type.name || comp.type.__name)) || 'anon');
        if (comp.setupState && typeof comp.setupState.sendMessage === 'function') { found = comp; break; }
        comp = comp.parent;
      }
      if (!found) return 'NO_SENDMESSAGE path=' + path.join('>');
      const s = found.setupState;
      window.__D2.stateBefore = JSON.stringify({
        isInitialized: (s.isInitialized && s.isInitialized.value) ?? s.isInitialized ?? null,
        currentSessionId: s.currentSessionId ? (s.currentSessionId.value ?? s.currentSessionId) : null,
        messagesLen: (s.messages && (s.messages.value || s.messages)?.length) ?? null,
      });
      const p = s.sendMessage('CDP直接触发测试2');
      if (p && typeof p.then === 'function') {
        p.then(() => { window.__D2.sendResolved = 'ok' }).catch((e) => { window.__D2.sendResolved = 'ERR:' + String(e && e.stack || e) });
      } else {
        window.__D2.sendResolved = 'sync-ok';
      }
      return 'SENT via ' + path.join('>') + ' stateBefore=' + window.__D2.stateBefore;
    })()
  `
  console.log('[4] trigger:', await evalJs(trigger))

  const start = Date.now()
  let lastLen = 0
  while (Date.now() - start < 15000) {
    await sleep(3000)
    const state = await evalJs(`JSON.stringify({resolved: window.__D2.sendResolved||null, logCount: (window.__D2.logs||[]).length, stateNow: window.__D2.stateBefore||null})`)
    console.log(`[t+${Math.round((Date.now()-start)/1000)}s]`, state)
  }

  console.log('===== 深度日志全文 =====')
  const raw = await evalJs(`JSON.stringify(window.__D2.logs || [])`)
  try {
    const arr = JSON.parse(raw)
    if (!arr.length) console.log('(空)')
    arr.forEach((l) => console.log(l))
  } catch { console.log(raw) }

  ws.close()
  console.log('[DONE]')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
