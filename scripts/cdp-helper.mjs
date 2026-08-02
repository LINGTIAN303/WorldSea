/**
 * cdp-helper.mjs — WebView2 CDP 自动化辅助脚本
 *
 * 连接 localhost:9222 的 Chrome DevTools Protocol，执行页面操作。
 * 用于端到端实测（长任务生命周期验证等），避免依赖浏览器 MCP 连接。
 *
 * 用法：
 *   node scripts/cdp-helper.mjs --list            # 列出 page targets
 *   node scripts/cdp-helper.mjs --reload          # 刷新当前页面
 *   node scripts/cdp-helper.mjs --eval "<expr>"   # 在页面执行 JS 表达式（returnByValue）
 *   node scripts/cdp-helper.mjs --wait <ms>       # 等待毫秒
 *
 * 注：CDP 页面 target 的 ws 地址从 /json 动态获取（取第一个 type=page 的 target）。
 */

const CDP_PORT = 9222

async function main() {
  const args = process.argv.slice(2)
  const mode = args[0] ?? '--list'
  const param = args[1] ?? ''

  // 获取 page target 的 ws 地址
  const listRes = await fetch(`http://localhost:${CDP_PORT}/json`)
  const targets = await listRes.json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) {
    console.error('NO_PAGE_TARGET')
    process.exit(1)
  }

  if (mode === '--list') {
    for (const t of targets) console.log(`${t.type}\t${t.title}\t${t.url}`)
    return
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let msgId = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  }
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++msgId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

  if (mode === '--reload') {
    await send('Page.enable')
    await send('Page.reload', { ignoreCache: true })
    console.log('RELOADED')
  } else if (mode === '--wait') {
    await new Promise((r) => setTimeout(r, Number(param) || 1000))
    console.log('WAITED')
  } else if (mode === '--key') {
    // 发送真实键盘按键（CDP Input.dispatchKeyEvent，比 synthetic KeyboardEvent 可靠）
    const key = param
    const vk = {
      F1: 112, F2: 113, F3: 114, Enter: 13, Escape: 27, Space: 32,
    }[key] ?? key.charCodeAt(0)
    await send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    })
    console.log('KEY_PRESSED: ' + key)
  } else if (mode === '--console') {
    // 抓取页面 console/异常日志：reload 后收集 N 毫秒
    const ms = Number(param) || 5000
    await send('Log.enable')
    await send('Runtime.enable')
    await send('Page.enable')
    const events = []
    const onEvt = (e) => {
      const m = JSON.parse(e.data)
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m)
        pending.delete(m.id)
      }
      if (m.method === 'Runtime.exceptionThrown') {
        events.push('EXC: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 400))
      } else if (m.method === 'Runtime.consoleAPICalled') {
        const args = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
        events.push(m.params.type + ': ' + args.slice(0, 400))
      } else if (m.method === 'Log.entryAdded') {
        events.push('LOG: ' + (m.params.entry?.text || '').slice(0, 400))
      }
    }
    ws.onmessage = onEvt
    await send('Page.reload', { ignoreCache: true })
    await new Promise((r) => setTimeout(r, ms))
    console.log(events.length ? events.slice(0, 40).join('\n') : 'NO_EVENTS')
  } else if (mode === '--net') {
    // 抓取网络失败/错误响应：reload 后收集 N 毫秒（--net <ms> 默认 9000）
    const ms = Number(param) || 9000
    await send('Network.enable')
    await send('Page.enable')
    const bad = []
    const onEvt = (e) => {
      const m = JSON.parse(e.data)
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m)
        pending.delete(m.id)
      }
      if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
        bad.push(m.params.response.status + ' ' + (m.params.response.url || '').slice(0, 160))
      } else if (m.method === 'Network.loadingFailed') {
        bad.push('FAIL ' + (m.params.errorText || '') + ' ' + (m.params.requestId || ''))
      }
    }
    ws.onmessage = onEvt
    await send('Page.reload', { ignoreCache: true })
    await new Promise((r) => setTimeout(r, ms))
    console.log(bad.length ? bad.slice(0, 40).join('\n') : 'NO_BAD_NET')
  } else if (mode === '--evalfile') {
    // 从文件读取表达式执行（避免 shell 转义问题）
    const code = await import('node:fs').then((fs) => fs.readFileSync(param, 'utf8'))
    const res = await send('Runtime.evaluate', {
      expression: code,
      returnByValue: true,
      awaitPromise: true,
    })
    if (res.result?.exceptionDetails) {
      console.error('EVAL_ERROR:', JSON.stringify(res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text))
      process.exitCode = 1
    } else {
      console.log(JSON.stringify(res.result?.result?.value))
    }
  } else if (mode === '--eval') {
    const res = await send('Runtime.evaluate', {
      expression: param,
      returnByValue: true,
      awaitPromise: true,
    })
    if (res.result?.exceptionDetails) {
      console.error('EVAL_ERROR:', JSON.stringify(res.result.exceptionDetails))
      process.exitCode = 1
    } else {
      console.log(JSON.stringify(res.result?.result?.value))
    }
  }

  ws.close()
}

main().catch((err) => {
  console.error('CDP_HELPER_FAIL:', err.message)
  process.exit(1)
})
