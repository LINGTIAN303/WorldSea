/**
 * splash-canvas.ts — WorldSmith 启动页 Canvas 动效引擎
 *
 * 双 Canvas 分层：
 *   - constellation 层：脉冲星座网络（固定动效，节点漂移 + 脉动 + 连线流光）
 *   - interaction 层：鼠标交互（光晕跟随 + 虚线引力线 + 涟漪扩散）
 *
 * 配色通过 getComputedStyle 读取项目 CSS 变量（跟随主题），fallback 到 Cyberpunk 默认值。
 * 设计稿来源：Ardot 设计文件 WorldSmith-Splash-Page (Cyberpunk UI 风格指南)
 */

// ────────────── 类型 ──────────────
interface StarNode {
  x: number
  y: number
  vx: number
  vy: number
  baseSize: number
  size: number
  isHub: boolean
  phase: number
  pulseSpeed: number
  colorRgb: [number, number, number]
  baseAlpha: number
}

interface Ripple {
  x: number
  y: number
  startTime: number
  duration: number
  maxRadius: number
}

interface ResolvedColors {
  primary: [number, number, number]
  secondary: [number, number, number]
  accent: [number, number, number]
  accentBright: [number, number, number]
}

// ────────────── 配置 ──────────────
const CONFIG = {
  nodeCount: 55,
  linkDistance: 160,
  mouseGlowRadius: 250,
  mouseLinkRadius: 200,
  mouseLinkCount: 6,
  rippleMaxCount: 6,
  rippleDuration: 1800,
  nodeMinSize: 1.2,
  nodeMaxSize: 3.5,
  hubNodeRatio: 0.12,
} as const

const FALLBACK_COLORS: ResolvedColors = {
  primary: [124, 58, 237],    // #7C3AED
  secondary: [139, 92, 246],  // #8B5CF6
  accent: [8, 145, 178],      // #0891B2
  accentBright: [34, 211, 238], // #22D3EE
}

// ────────────── 工具 ──────────────
function rgba(c: [number, number, number], a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

/** 从 CSS 变量解析颜色，失败回退到 fallback */
function resolveColors(): ResolvedColors {
  const root = document.documentElement
  const style = getComputedStyle(root)
  const parse = (varName: string, fallback: [number, number, number]): [number, number, number] => {
    const raw = style.getPropertyValue(varName).trim()
    if (!raw) return fallback
    // 支持 #hex / rgb() / rgba()
    if (raw.startsWith('#')) {
      const hex = raw.slice(1)
      if (hex.length === 6) {
        return [
          parseInt(hex.slice(0, 2), 16),
          parseInt(hex.slice(2, 4), 16),
          parseInt(hex.slice(4, 6), 16),
        ]
      }
    }
    const m = raw.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
    if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])]
    return fallback
  }
  return {
    primary: parse('--color-primary', FALLBACK_COLORS.primary),
    secondary: parse('--purple-400', FALLBACK_COLORS.secondary),
    accent: parse('--color-accent', FALLBACK_COLORS.accent),
    accentBright: parse('--teal-400', FALLBACK_COLORS.accentBright),
  }
}

// ────────────── 引擎主体 ──────────────
export interface SplashEngine {
  destroy(): void
}

export function createSplashEngine(
  constCanvas: HTMLCanvasElement,
  intCanvas: HTMLCanvasElement,
): SplashEngine {
  const constCtx = constCanvas.getContext('2d')!
  const intCtx = intCanvas.getContext('2d')!

  let W = 0
  let H = 0
  let DPR = 1
  let nodes: StarNode[] = []
  let ripples: Ripple[] = []
  let mouse = { x: 0, y: 0, active: false }
  let lastRippleTime = 0
  let rafId = 0
  let destroyed = false
  let colors = resolveColors()

  // ── 尺寸适配 ──
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2)
    W = window.innerWidth
    H = window.innerHeight
    for (const c of [constCanvas, intCanvas]) {
      c.width = W * DPR
      c.height = H * DPR
      c.style.width = W + 'px'
      c.style.height = H + 'px'
    }
    constCtx.setTransform(DPR, 0, 0, DPR, 0, 0)
    intCtx.setTransform(DPR, 0, 0, DPR, 0, 0)
  }

  // ── 节点初始化 ──
  function initNodes() {
    nodes = []
    for (let i = 0; i < CONFIG.nodeCount; i++) {
      const isHub = Math.random() < CONFIG.hubNodeRatio
      const size = isHub
        ? CONFIG.nodeMaxSize * (0.8 + Math.random() * 0.4)
        : CONFIG.nodeMinSize + Math.random() * (CONFIG.nodeMaxSize - CONFIG.nodeMinSize - 1)
      nodes.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        baseSize: size,
        size,
        isHub,
        phase: Math.random() * Math.PI * 2,
        pulseSpeed: 0.008 + Math.random() * 0.012,
        colorRgb: isHub
          ? colors.primary
          : (Math.random() < 0.3 ? colors.accent : colors.secondary),
        baseAlpha: isHub ? 0.7 : 0.35 + Math.random() * 0.25,
      })
    }
  }

  // ── 鼠标事件 ──
  function onMouseMove(e: MouseEvent) {
    mouse.x = e.clientX
    mouse.y = e.clientY
    mouse.active = true
    const now = performance.now()
    if (now - lastRippleTime > 600) {
      lastRippleTime = now
      spawnRipple(e.clientX, e.clientY)
    }
  }
  function onMouseLeave() { mouse.active = false }
  function onMouseEnter() { mouse.active = true }
  function onClick(e: MouseEvent) {
    for (let i = 0; i < 2; i++) {
      setTimeout(() => spawnRipple(e.clientX, e.clientY), i * 200)
    }
  }
  function spawnRipple(x: number, y: number) {
    if (ripples.length >= CONFIG.rippleMaxCount) ripples.shift()
    ripples.push({
      x, y,
      startTime: performance.now(),
      duration: CONFIG.rippleDuration,
      maxRadius: 120 + Math.random() * 60,
    })
  }

  // ── 绘制：星座网络（固定动效） ──
  function drawConstellation(time: number) {
    constCtx.clearRect(0, 0, W, H)

    // 更新节点
    for (const n of nodes) {
      n.x += n.vx
      n.y += n.vy
      if (n.x < 0 || n.x > W) n.vx *= -1
      if (n.y < 0 || n.y > H) n.vy *= -1
      n.x = Math.max(0, Math.min(W, n.x))
      n.y = Math.max(0, Math.min(H, n.y))
      n.phase += n.pulseSpeed
      n.size = n.baseSize * (0.7 + Math.sin(n.phase) * 0.3)
    }

    // 连线
    const linkDist2 = CONFIG.linkDistance * CONFIG.linkDistance
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        const d2 = dist2(a.x, a.y, b.x, b.y)
        if (d2 < linkDist2) {
          const d = Math.sqrt(d2)
          const alpha = (1 - d / CONFIG.linkDistance) * 0.15
          constCtx.strokeStyle = rgba(colors.secondary, alpha)
          constCtx.lineWidth = 0.5
          constCtx.beginPath()
          constCtx.moveTo(a.x, a.y)
          constCtx.lineTo(b.x, b.y)
          constCtx.stroke()

          // 流光亮点（枢纽节点间）
          if (a.isHub || b.isHub) {
            const flow = (Math.sin(time * 0.0006 + a.phase) + 1) / 2
            const fx = a.x + (b.x - a.x) * flow
            const fy = a.y + (b.y - a.y) * flow
            constCtx.fillStyle = rgba(colors.primary, alpha * 2.5)
            constCtx.beginPath()
            constCtx.arc(fx, fy, 1.2, 0, Math.PI * 2)
            constCtx.fill()
          }
        }
      }
    }

    // 节点
    for (const n of nodes) {
      const pulseAlpha = n.baseAlpha * (0.6 + Math.sin(n.phase) * 0.4)
      if (n.isHub) {
        const r = n.size * 5
        const grad = constCtx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r)
        grad.addColorStop(0, rgba(n.colorRgb, pulseAlpha * 0.3))
        grad.addColorStop(1, rgba(n.colorRgb, 0))
        constCtx.fillStyle = grad
        constCtx.beginPath()
        constCtx.arc(n.x, n.y, r, 0, Math.PI * 2)
        constCtx.fill()
      }
      constCtx.fillStyle = rgba(n.colorRgb, pulseAlpha)
      constCtx.beginPath()
      constCtx.arc(n.x, n.y, n.size, 0, Math.PI * 2)
      constCtx.fill()
    }
  }

  // ── 绘制：鼠标交互 ──
  function drawInteraction(time: number) {
    intCtx.clearRect(0, 0, W, H)
    if (!mouse.active) return

    // 1. 光晕
    const glowR = CONFIG.mouseGlowRadius
    const glowGrad = intCtx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, glowR)
    glowGrad.addColorStop(0, rgba(colors.accentBright, 0.10))
    glowGrad.addColorStop(0.4, rgba(colors.primary, 0.04))
    glowGrad.addColorStop(1, rgba(colors.accent, 0))
    intCtx.fillStyle = glowGrad
    intCtx.fillRect(mouse.x - glowR, mouse.y - glowR, glowR * 2, glowR * 2)

    // 2. 引力线
    const linkR2 = CONFIG.mouseLinkRadius * CONFIG.mouseLinkRadius
    const candidates: { node: StarNode; d2: number }[] = []
    for (const n of nodes) {
      const d2 = dist2(mouse.x, mouse.y, n.x, n.y)
      if (d2 < linkR2) candidates.push({ node: n, d2 })
    }
    candidates.sort((a, b) => a.d2 - b.d2)
    const linkCount = Math.min(CONFIG.mouseLinkCount, candidates.length)
    for (let i = 0; i < linkCount; i++) {
      const c = candidates[i]
      const d = Math.sqrt(c.d2)
      const alpha = (1 - d / CONFIG.mouseLinkRadius) * 0.35
      const color = i === 0 ? colors.accentBright : colors.accent
      intCtx.strokeStyle = rgba(color, alpha)
      intCtx.lineWidth = 0.6
      intCtx.setLineDash([4, 6])
      intCtx.lineDashOffset = -time * 0.05
      intCtx.beginPath()
      intCtx.moveTo(mouse.x, mouse.y)
      intCtx.lineTo(c.node.x, c.node.y)
      intCtx.stroke()
      intCtx.setLineDash([])
      intCtx.fillStyle = rgba(color, alpha * 1.5)
      intCtx.beginPath()
      intCtx.arc(c.node.x, c.node.y, c.node.size + 1.5, 0, Math.PI * 2)
      intCtx.fill()
    }

    // 3. 涟漪
    const now = performance.now()
    ripples = ripples.filter(r => {
      const elapsed = now - r.startTime
      const progress = elapsed / r.duration
      if (progress >= 1) return false
      const radius = r.maxRadius * progress
      const alpha = (1 - progress) * 0.3
      intCtx.strokeStyle = rgba(colors.accent, alpha)
      intCtx.lineWidth = 1 - progress * 0.7
      intCtx.beginPath()
      intCtx.arc(r.x, r.y, Math.max(0.1, radius), 0, Math.PI * 2)
      intCtx.stroke()
      return true
    })

    // 4. 中心微光晕
    const haloGrad = intCtx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 30)
    haloGrad.addColorStop(0, rgba(colors.accentBright, 0.15))
    haloGrad.addColorStop(1, rgba(colors.accentBright, 0))
    intCtx.fillStyle = haloGrad
    intCtx.fillRect(mouse.x - 30, mouse.y - 30, 60, 60)
  }

  // ── 主循环 ──
  function loop(time: number) {
    if (destroyed) return
    drawConstellation(time)
    drawInteraction(time)
    rafId = requestAnimationFrame(loop)
  }

  // ── 事件绑定 ──
  function onResize() { resize(); initNodes() }

  resize()
  initNodes()
  mouse.x = W / 2
  mouse.y = H / 2

  window.addEventListener('resize', onResize)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseleave', onMouseLeave)
  window.addEventListener('mouseenter', onMouseEnter)
  window.addEventListener('click', onClick)

  rafId = requestAnimationFrame(loop)

  return {
    destroy() {
      destroyed = true
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseleave', onMouseLeave)
      window.removeEventListener('mouseenter', onMouseEnter)
      window.removeEventListener('click', onClick)
    },
  }
}
