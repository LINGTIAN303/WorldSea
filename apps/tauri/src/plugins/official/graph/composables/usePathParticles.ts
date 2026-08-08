import { ref, onBeforeUnmount } from 'vue'
import type Sigma from 'sigma'
import type Graph from 'graphology'

interface Particle {
  edgeId: string
  source: string
  target: string
  progress: number
  speed: number
}

export function usePathParticles() {
  const particles = ref<Particle[]>([])
  let animId = 0
  let sigmaInstance: Sigma | null = null
  let graphInstance: Graph | null = null
  let overlayCanvas: HTMLCanvasElement | null = null
  let overlayCtx: CanvasRenderingContext2D | null = null
  let pathEdgeIds = new Set<string>()
  let lastTime = 0

  function init(sigma: Sigma, graph: Graph): void {
    sigmaInstance = sigma
    graphInstance = graph

    const container = sigma.getContainer()
    if (!container) return

    overlayCanvas = document.createElement('canvas')
    overlayCanvas.style.position = 'absolute'
    overlayCanvas.style.top = '0'
    overlayCanvas.style.left = '0'
    overlayCanvas.style.width = '100%'
    overlayCanvas.style.height = '100%'
    overlayCanvas.style.pointerEvents = 'none'
    overlayCanvas.style.zIndex = '10'
    container.style.position = 'relative'
    container.appendChild(overlayCanvas)
    overlayCtx = overlayCanvas.getContext('2d')

    resizeOverlay()
    window.addEventListener('resize', resizeOverlay)

    sigma.on('afterRender', renderParticles)
    startAnimation()
  }

  function destroy(): void {
    cancelAnimationFrame(animId)
    window.removeEventListener('resize', resizeOverlay)
    if (sigmaInstance) {
      sigmaInstance.removeListener('afterRender', renderParticles)
    }
    overlayCanvas?.remove()
    overlayCanvas = null
    overlayCtx = null
    sigmaInstance = null
    graphInstance = null
    particles.value = []
    pathEdgeIds.clear()
  }

  function resizeOverlay(): void {
    if (!overlayCanvas || !sigmaInstance) return
    const container = sigmaInstance.getContainer()
    if (!container) return
    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    overlayCanvas.width = rect.width * dpr
    overlayCanvas.height = rect.height * dpr
    overlayCanvas.style.width = rect.width + 'px'
    overlayCanvas.style.height = rect.height + 'px'
  }

  function setPath(edgeIds: string[]): void {
    pathEdgeIds = new Set(edgeIds)
    particles.value = edgeIds.map(eid => ({
      edgeId: eid,
      source: '',
      target: '',
      progress: Math.random(),
      speed: 0.003 + Math.random() * 0.004,
    }))

    if (graphInstance) {
      for (const p of particles.value) {
        if (graphInstance.hasEdge(p.edgeId)) {
          p.source = graphInstance.source(p.edgeId)
          p.target = graphInstance.target(p.edgeId)
        }
      }
    }
  }

  function clearPath(): void {
    pathEdgeIds.clear()
    particles.value = []
  }

  function startAnimation(): void {
    lastTime = performance.now()
    function loop(now: number) {
      const dt = now - lastTime
      lastTime = now

      for (const p of particles.value) {
        p.progress += p.speed * (dt / 16)
        if (p.progress > 1) p.progress -= 1
      }

      animId = requestAnimationFrame(loop)
    }
    animId = requestAnimationFrame(loop)
  }

  function renderParticles(): void {
    if (!overlayCtx || !overlayCanvas || !sigmaInstance || !graphInstance) return
    if (particles.value.length === 0) return

    const dpr = window.devicePixelRatio || 1
    const ctx = overlayCtx
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)
    ctx.save()
    ctx.scale(dpr, dpr)

    for (const p of particles.value) {
      if (!graphInstance.hasNode(p.source) || !graphInstance.hasNode(p.target)) continue

      const srcAttrs = graphInstance.getNodeAttributes(p.source)
      const tgtAttrs = graphInstance.getNodeAttributes(p.target)
      if (srcAttrs.hidden || tgtAttrs.hidden) continue

      const srcDisplay = sigmaInstance.getNodeDisplayData(p.source)
      const tgtDisplay = sigmaInstance.getNodeDisplayData(p.target)
      if (!srcDisplay || !tgtDisplay) continue

      const x = srcDisplay.x + (tgtDisplay.x - srcDisplay.x) * p.progress
      const y = srcDisplay.y + (tgtDisplay.y - srcDisplay.y) * p.progress

      const gradient = ctx.createRadialGradient(x, y, 0, x, y, 6)
      gradient.addColorStop(0, 'rgba(79, 195, 247, 0.9)')
      gradient.addColorStop(0.5, 'rgba(79, 195, 247, 0.4)')
      gradient.addColorStop(1, 'rgba(79, 195, 247, 0)')

      ctx.beginPath()
      ctx.arc(x, y, 6, 0, Math.PI * 2)
      ctx.fillStyle = gradient
      ctx.fill()

      ctx.beginPath()
      ctx.arc(x, y, 2, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'
      ctx.fill()
    }

    ctx.restore()
  }

  onBeforeUnmount(() => destroy())

  return {
    init,
    destroy,
    setPath,
    clearPath,
  }
}
