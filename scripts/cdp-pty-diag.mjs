// PTY 后端链路实测：直接 invoke cmd_pty_spawn/write/kill + listen pty-output-{id}
// 验证 Rust 端 PTY 进程真实启动、输出事件真实推送（前端 openTerminal 的 invoke 代码路径等价）
const TARGET = 'http://localhost:9222/json/list'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PTY_ID = 'pty-diag-test'

async function main() {
  const list = await (await fetch(TARGET)).json()
  const page = list.find((t) => t.type === 'page' && /^https?:/.test(t.url))
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

  // 检查 Tauri invoke 可用
  const tauriCheck = await evalJs(`
    (() => {
      const T = window.__TAURI_INTERNALS__;
      return T ? JSON.stringify({ hasInvoke: typeof T.invoke === 'function', keys: Object.keys(T).slice(0, 10) }) : 'NO_TAURI';
    })()
  `)
  console.log('[2] tauri:', tauriCheck)

  // 注册底层 listen（plugin:event|listen）收集 pty-output
  await evalJs(`
    (() => {
      window.__PTYEVTS = [];
      return 'reset';
    })()
  `)

  // 用 Tauri event plugin 的 listen（通过 @tauri-apps/api 的底层协议）
  const listenRes = await evalJs(`
    (async () => {
      try {
        // 直接调底层 plugin:event|listen（与 @tauri-apps/api/event 的 listen 等价）
        const T = window.__TAURI_INTERNALS__;
        // Tauri v2 内部：window.__TAURI_INTERNALS__.invoke('plugin:event|listen', { event, target, handler })
        const handlerId = T.transformCallback((payload) => {
          try {
            const t = typeof payload;
            let detail = '';
            if (payload && typeof payload === 'object') {
              detail = 'keys=' + Object.keys(payload).join(',') + ' val=' + JSON.stringify(payload).slice(0, 120);
            } else {
              detail = 'val=' + String(payload).slice(0, 120);
            }
            window.__PTYEVTS.push('type=' + t + ' ' + detail);
          } catch (e) {
            window.__PTYEVTS.push('HANDLER_ERR:' + String(e));
          }
        });
        const unlistenId = await T.invoke('plugin:event|listen', {
          event: 'pty-output-${PTY_ID}',
          target: { kind: 'Any', label: null },
          handler: handlerId,
          options: null,
        });
        window.__PTY_UNLISTEN = () => T.invoke('plugin:event|unlisten', { event: 'pty-output-${PTY_ID}', target: { kind: 'Any' }, handlerId: unlistenId });
        return 'listened:' + unlistenId;
      } catch (e) {
        return 'LISTEN_FAIL:' + String(e && e.message || e);
      }
    })()
  `)
  console.log('[3] listen:', listenRes)

  // spawn PTY
  const spawnRes = await evalJs(`
    (async () => {
      try {
        await window.__TAURI_INTERNALS__.invoke('cmd_pty_spawn', {
          id: '${PTY_ID}',
          shell: null,
          cwd: null,
          cols: 80,
          rows: 24,
        });
        return 'spawn-ok';
      } catch (e) {
        return 'SPAWN_FAIL:' + String(e && e.message || e);
      }
    })()
  `)
  console.log('[4] spawn:', spawnRes)
  if (spawnRes.startsWith('SPAWN_FAIL')) process.exit(1)

  // 发命令：先回复 DSR 光标位置（cmd.exe 启动时请求 \x1b[6n，xterm.js 会自动回复；
  // 裸链路需手动回复，否则 cmd.exe 等待不执行后续命令），再发 echo
  const writeRes = await evalJs(`
    (async () => {
      try {
        await window.__TAURI_INTERNALS__.invoke('cmd_pty_write', { id: '${PTY_ID}', data: '\\u001b[1;1Recho hello-pty-diag\\r' });
        return 'write-ok';
      } catch (e) {
        return 'WRITE_FAIL:' + String(e && e.message || e);
      }
    })()
  `)
  console.log('[5] write:', writeRes)

  await sleep(2500)
  const events = await evalJs(`JSON.stringify(window.__PTYEVTS || [])`)
  console.log('[6] pty-output 事件:', events)

  // kill
  const killRes = await evalJs(`
    (async () => {
      try {
        await window.__TAURI_INTERNALS__.invoke('cmd_pty_kill', { id: '${PTY_ID}' });
        if (window.__PTY_UNLISTEN) { try { await window.__PTY_UNLISTEN(); } catch {} }
        return 'kill-ok';
      } catch (e) {
        return 'KILL_FAIL:' + String(e && e.message || e);
      }
    })()
  `)
  console.log('[7] kill:', killRes)

  const hasEcho = JSON.stringify(events).includes('hello-pty-diag')
  console.log('[8] 结论:', hasEcho ? 'PASS - PTY 进程启动 + 输出推送链路完整' : 'FAIL - 未收到 echo 输出')

  ws.close()
  console.log('[DONE]')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
