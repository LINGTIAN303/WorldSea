// CDP 诊断脚本 (Node)：hook console + 注入输入 + 收集事件流
// 用法: node scripts/cdp-diag.mjs
// 依赖: Node >= 22 (内置 WebSocket)
const TARGET = 'http://localhost:9222/json/list'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // 1. 获取页面
  const list = await (await fetch(TARGET)).json()
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')
  console.log('[1] page:', page.title, '|', page.url)

  // 2. 连接 WS
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  console.log('[2] ws connected')

  let msgId = 0
  const pending = new Map()
  const events = []
  ws.onmessage = (e) => {
    let data
    try { data = JSON.parse(e.data) } catch { return }
    if (data.id != null) {
      const p = pending.get(data.id)
      if (p) { pending.delete(data.id); p(data) }
    } else {
      events.push(data)
    }
  }

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++msgId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

  // 3. hook console
  await send('Runtime.enable')
  await send('Log.enable')
  const hookCode = `
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
  const r3 = await send('Runtime.evaluate', { expression: hookCode, returnByValue: true })
  console.log('[3] hook result:', JSON.stringify(r3.result?.result?.value))
  const r4 = await send('Runtime.evaluate', {
    expression: `(()=>{const ta=document.querySelector("textarea.chat-textarea"); if(ta){ta.focus(); return "focused"} return "NOT_FOUND"})()`,
    returnByValue: true,
  })
  console.log('[4] focus:', JSON.stringify(r4.result?.result?.value))
  await sleep(300)

  // 4. 输入 + Enter
  await send('Input.insertText', { text: 'CDP诊断消息' })
  await sleep(500)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  console.log('[5] sent, collecting 25s...')

  // 5. 收集 25s
  const start = Date.now()
  const lines = []
  while (Date.now() - start < 25000) {
    await sleep(200)
    while (events.length) {
      const evt = events.shift()
      if (evt.method === 'Runtime.consoleAPICalled') {
        const vals = (evt.params.args || []).map((a) => a.value ?? a.description ?? '')
        lines.push(`CONSOLE[${evt.params.type}]: ${vals.join(' ')}`)
      } else if (evt.method === 'Log.entryAdded') {
        lines.push(`LOG[${evt.params.entry.level}]: ${evt.params.entry.text}`)
      } else if (evt.method === 'Runtime.exceptionThrown') {
        lines.push(`EXCEPTION: ${evt.params.exceptionDetails.text} ${evt.params.exceptionDetails.exception?.description || ''}`)
      }
    }
  }

  console.log('===== 收集结果（25s） =====')
  if (!lines.length) console.log('(无 console 输出)')
  else lines.forEach((l) => console.log(l))

  // 6. 读取 diagLogs
  const r6 = await send('Runtime.evaluate', {
    expression: `JSON.stringify({logs: window.__diagLogs || [], taValue: (document.querySelector("textarea.chat-textarea")||{}).value || null, bubbleCount: document.querySelectorAll("[class*=user],[class*=bubble],[class*=message]").length})`,
    returnByValue: true,
  })
  console.log('===== __diagLogs =====')
  console.log(r6.result?.result?.value ?? JSON.stringify(r6))
  ws.close()
  console.log('[DONE]')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
