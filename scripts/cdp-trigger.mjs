// CDP 直接触发脚本 (Node)：hook console → 找 Vue 组件 → 直接调 sendMessage → 读 __diagLogs
// 用法: node scripts/cdp-trigger.mjs
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

  // 1. hook console
  await send('Runtime.enable')
  const hook = `
    window.__diagLogs = [];
    const __origLog = console.log.bind(console);
    console.log = function() {
      try {
        const parts = Array.prototype.map.call(arguments, function(x) {
          if (typeof x === 'string') return x;
          if (x && x.stack) return x.stack;
          return String(x);
        });
        window.__diagLogs.push(parts.join(' '));
      } catch(e) {}
      __origLog.apply(console, arguments);
    };
    'hooked'
  `
  console.log('[3] hook:', await evalJs(hook))

  // 2. 找 Vue 组件并直接调用 sendMessage
  const trigger = `
    (() => {
      const ta = document.querySelector('textarea.chat-textarea');
      if (!ta) return 'NO_TEXTAREA';
      let comp = ta.__vueParentComponent || null;
      let found = null;
      let path = [];
      while (comp) {
        path.push(comp.type && (comp.type.name || comp.type.__name) || 'anon');
        if (comp.setupState && typeof comp.setupState.sendMessage === 'function') { found = comp; break; }
        if (comp.exposed && typeof comp.exposed.sendMessage === 'function') { found = comp; break; }
        comp = comp.parent;
      }
      if (!found) return 'NO_SENDMESSAGE path=' + path.join('>');
      const fn = typeof found.setupState.sendMessage === 'function' ? found.setupState.sendMessage : found.exposed.sendMessage;
      const p = fn('CDP直接触发测试');
      if (p && typeof p.then === 'function') {
        p.then(() => { window.__sendResolved = 'ok' }).catch((e) => { window.__sendResolved = 'ERR:' + String(e) });
      } else {
        window.__sendResolved = 'sync-ok';
      }
      return 'SENT via ' + path.join('>');
    })()
  `
  console.log('[4] trigger:', await evalJs(trigger))

  // 3. 等待 20s，轮询 __sendResolved 与 __diagLogs 长度
  const start = Date.now()
  let lastLen = 0
  while (Date.now() - start < 20000) {
    await sleep(3000)
    const state = await evalJs(`JSON.stringify({resolved: window.__sendResolved||null, logCount: (window.__diagLogs||[]).length})`)
    console.log(`[t+${Math.round((Date.now()-start)/1000)}s]`, state)
    const n = await evalJs(`(window.__diagLogs||[]).length`)
    if (n > lastLen) lastLen = n
  }

  // 4. 输出全部日志
  console.log('===== __diagLogs 全文 =====')
  const logs = await evalJs(`JSON.stringify(window.__diagLogs || [])`)
  try {
    const arr = JSON.parse(logs)
    if (!arr.length) console.log('(空)')
    arr.forEach((l) => console.log(l))
  } catch {
    console.log(logs)
  }

  ws.close()
  console.log('[DONE]')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
