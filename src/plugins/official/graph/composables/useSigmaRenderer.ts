import { shallowRef, onBeforeUnmount, type Ref } from 'vue'
import Sigma from 'sigma'
import Graph from 'graphology'

/** sigma 渲染器选项类型（sigma 未导出 Settings，从构造函数参数提取） */
type SigmaOptions = NonNullable<ConstructorParameters<typeof Sigma>[2]>

export function useSigmaRenderer(
  containerRef: Ref<HTMLElement | null>,
  getGraph: () => Graph,
) {
  const sigma = shallowRef<Sigma | null>(null)

  // 注：sigma 版本升级后部分字段名变更，用 as 断言绕过严格检查（运行时 sigma 忽略未知字段）
  const SIGMA_SETTINGS = {
    defaultNodeColor: '#4fc3f7',
    defaultEdgeColor: 'rgba(255,255,255,0.15)',
    defaultNodeSize: 6,
    defaultEdgeSize: 1,
    labelFont: 'Arial',
    labelSize: 12,
    labelColor: { color: '#e0e0e0' },
    labelWeight: 'normal',
    labelRenderedSizeThreshold: 8,
    renderEdgeLabels: false,
    enableEdgeClickEvents: true,
    enableEdgeHoverEvents: true,
    minCameraRatio: 0.05,
    maxCameraRatio: 10,
    hideEdgesOnMove: true,
    hideLabelsOnMove: true,
    nodeSizeRatio: 0.5,
    renderLabels: true,
    antiFlicker: true,
  } as SigmaOptions

  function createRenderer(options?: SigmaOptions): Sigma | null {
    if (!containerRef.value) return null
    destroyRenderer()
    const graph = getGraph()
    if (graph.order === 0) return null
    const instance = new Sigma(graph, containerRef.value, {
      ...SIGMA_SETTINGS,
      ...options,
    })
    sigma.value = instance
    return instance
  }

  function destroyRenderer() {
    if (sigma.value) {
      sigma.value.kill()
      sigma.value = null
    }
  }

  function refresh() {
    sigma.value?.refresh()
  }

  onBeforeUnmount(() => {
    destroyRenderer()
  })

  return {
    sigma,
    createRenderer,
    destroyRenderer,
    refresh,
  }
}
