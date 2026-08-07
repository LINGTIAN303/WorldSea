/**
 * cdp-audit.mjs — 视觉审查专用 CDP 驱动脚本
 *
 * 连接 localhost:9222（WebView2 CDP），支持截图/执行JS/点击/hover/按键/等待。
 *
 * 用法：
 *   node scripts/cdp-audit.mjs --shot <name>            # 截图到 docs/details/截图/live/<name>.png
 *   node scripts/cdp-audit.mjs --eval "<expr>"          # 执行 JS（returnByValue）
 *   node scripts/cdp-audit.mjs --evalfile <path>        # 从文件读取 JS 执行
 *   node scripts/cdp-audit.mjs --click "<selector>"     # 点击匹配元素（真实鼠标事件）
 *   node scripts/cdp-audit.mjs --hover "<selector>"     # 悬停匹配元素（触发 hover 态）
 *   node scripts/cdp-audit.mjs --seq <json-file>        # 执行动作序列（见文件内格式）
 *   node scripts/cdp-audit.mjs --list                   # 列出 CDP targets
 *
 * --seq JSON 格式：[{ "eval": "..." }, { "click": "sel" }, { "hover": "sel" },
 *                   { "key": "Enter" }, { "wait": 500 }, { "shot": "name" }]
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CDP_ORIGIN = 'http://127.0.0.1:9222' // 注意：必须用 127.0.0.1，localhost 会解析到 ::1（IPv6）而 WebView2 只监听 IPv4
const __dirname = dirname(fileURLToPath(import.meta.url))
const SHOT_DIR = join(__dirname, '..', 'docs', 'details', '截图', 'live')

async function connect() {
  const listRes = await fetch(`${CDP_ORIGIN}/json`)
  const targets = await listRes.json()
  const page = targets.find((t) => t.type === 'page' && /^https?:/.test(t.url))
  if (!page) {
    console.error('NO_PAGE_TARGET')
    process.exit(1)
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
  return { ws, send, page }
}

// 获取元素中心坐标（页面坐标系）
const RECT_EXPR = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  el.scrollIntoView({ block: 'nearest' });
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
})()`

async function main() {
  const args = process.argv.slice(2)
  const mode = args[0] ?? '--list'
  const param = args[1] ?? ''

  const { ws, send, page } = await connect()

  if (mode === '--list') {
    const listRes = await fetch(`${CDP_ORIGIN}/json`)
    for (const t of await listRes.json()) console.log(`${t.type}\t${t.title}\t${t.url}`)
    ws.close()
    return
  }

  await send('Page.enable')

  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) {
      throw new Error('EVAL_ERROR: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || '').slice(0, 500))
    }
    return r.result?.result?.value
  }

  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    mkdirSync(SHOT_DIR, { recursive: true })
    const file = join(SHOT_DIR, name.endsWith('.png') ? name : `${name}.png`)
    writeFileSync(file, Buffer.from(r.result.data, 'base64'))
    console.log('SHOT:' + file)
  }

  const click = async (sel) => {
    const rect = await evalJs(RECT_EXPR(sel))
    if (!rect) throw new Error('CLICK_TARGET_NOT_FOUND: ' + sel)
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type, x: rect.x, y: rect.y, button: 'left', clickCount: 1,
      })
    }
    console.log(`CLICKED:${sel} @(${Math.round(rect.x)},${Math.round(rect.y)})`)
  }

  const hover = async (sel) => {
    const rect = await evalJs(RECT_EXPR(sel))
    if (!rect) throw new Error('HOVER_TARGET_NOT_FOUND: ' + sel)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y })
    console.log(`HOVERED:${sel} @(${Math.round(rect.x)},${Math.round(rect.y)})`)
  }

  const key = async (k) => {
    const vk = { F1: 112, F2: 113, F3: 114, Enter: 13, Escape: 27, Space: 32, Tab: 9 }[k] ?? k.charCodeAt(0)
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
    console.log('KEY:' + k)
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms)).then(() => console.log('WAITED:' + ms))

  if (mode === '--shot') {
    await shot(param)
  } else if (mode === '--eval') {
    console.log(JSON.stringify(await evalJs(param)))
  } else if (mode === '--evalfile') {
    console.log(JSON.stringify(await evalJs(readFileSync(param, 'utf8'))))
  } else if (mode === '--click') {
    await click(param)
  } else if (mode === '--hover') {
    await hover(param)
  } else if (mode === '--key') {
    await key(param)
  } else if (mode === '--wait') {
    await wait(Number(param) || 1000)
  } else if (mode === '--seq') {
    const steps = JSON.parse(readFileSync(param, 'utf8'))
    for (const [i, s] of steps.entries()) {
      try {
        if (s.eval !== undefined) console.log(`[${i}]`, JSON.stringify(await evalJs(s.eval)))
        else if (s.click) await click(s.click)
        else if (s.hover) await hover(s.hover)
        else if (s.key) await key(s.key)
        else if (s.wait) await wait(s.wait)
        else if (s.shot) await shot(s.shot)
      } catch (e) {
        console.error(`[${i}] STEP_FAIL:`, e.message)
      }
    }
  }

  ws.close()
}

main().catch((err) => {
  console.error('CDP_AUDIT_FAIL:', err.message)
  process.exit(1)
})
