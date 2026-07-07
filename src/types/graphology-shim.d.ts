/**
 * graphology 类型补丁（TS 6.0 兼容）
 * ============================================================================
 * 根因：graphology 0.26 的 d.ts 中 `Graph extends AbstractGraph`（来自
 *   graphology-types 0.24.8 的 `declare abstract class AbstractGraph`）。
 *   TS 6.0 对该 abstract class 泛型继承链的解析发生变化，导致 Graph 实例
 *   方法（addNode/hasNode/forEachNode...）在类型层不可见，运行时方法本就存在。
 *
 * 修复：通过 module augmentation（模块增强）向默认导出 Graph class 合并
 *   业务代码实际使用到的方法签名。签名以宽松为主，避免引入新的类型错误；
 *   真实类型精度由 graphology-types 原始声明在非 TS6 环境下保证。
 * ============================================================================
 */
declare module 'graphology' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export default class Graph<
    NodeAttributes extends Record<string, any> = Record<string, any>,
    EdgeAttributes extends Record<string, any> = Record<string, any>,
    GraphAttributes extends Record<string, any> = Record<string, any>
  > {
    constructor(options?: {
      multi?: boolean
      type?: 'mixed' | 'directed' | 'undirected'
      allowSelfLoops?: boolean
    })

    // 节点
    addNode(node: string, attributes?: NodeAttributes): string
    addDirectedNode(node: string, attributes?: NodeAttributes): string
    addUndirectedNode(node: string, attributes?: NodeAttributes): string
    hasNode(node: string): boolean
    dropNode(node: string): void
    mergeNode(node: string, attributes?: NodeAttributes): [string, boolean]
    mergeNodes(nodes: Array<[string, NodeAttributes?]>): void

    // 边
    addEdge(source: string, target: string, attributes?: EdgeAttributes): string
    addDirectedEdge(source: string, target: string, attributes?: EdgeAttributes): string
    addUndirectedEdge(source: string, target: string, attributes?: EdgeAttributes): string
    hasEdge(source: string, target: string): boolean
    hasEdge(edge: string): boolean
    dropEdge(edge: string): void
    mergeEdge(source: string, target: string, attributes?: EdgeAttributes): [string, boolean]

    // 遍历
    nodes(): string[]
    edges(): string[]
    edges(node: string): string[]
    inEdges(node: string): string[]
    outEdges(node: string): string[]
    neighbors(node: string): string[]
    inNeighbors(node: string): string[]
    outNeighbors(node: string): string[]
    forEachNode(callback: (key: string, attributes: NodeAttributes) => void): void
    forEachEdge(callback: (key: string, attributes: EdgeAttributes, source: string, target: string, sourceAttributes: NodeAttributes, targetAttributes: NodeAttributes, undirected: boolean) => void): void
    forEachEdge(node: string, callback: (key: string, attributes: EdgeAttributes, source: string, target: string, sourceAttributes: NodeAttributes, targetAttributes: NodeAttributes, undirected: boolean) => void): void
    forEachAdjacency(callback: (adjacency: { node: string; neighbor: string; edge: string; attributes: NodeAttributes; neighborAttributes: NodeAttributes; edgeAttributes: EdgeAttributes; undirected: boolean }) => void): void

    // 度
    degree(node: string): number
    inDegree(node: string): number
    outDegree(node: string): number
    directedDegree(node: string): number
    undirectedDegree(node: string): number

    // 端点
    source(edge: string): string
    target(edge: string): string
    opposite(node: string, edge: string): string
    edge(source: string, target: string): string | undefined
    directedEdge(source: string, target: string): string | undefined
    undirectedEdge(source: string, target: string): string | undefined

    // 属性 - 节点
    getNodeAttribute<K extends keyof NodeAttributes>(node: string, name: K): NodeAttributes[K]
    getNodeAttribute(node: string, name: string): any
    getNodeAttributes(node: string): NodeAttributes
    setNodeAttribute<K extends keyof NodeAttributes>(node: string, name: K, value: NodeAttributes[K]): void
    setNodeAttribute(node: string, name: string, value: any): void
    updateNodeAttribute(node: string, name: string, updater: (value: any) => any): void
    removeNodeAttribute(node: string, name: string): void
    mergeNodeAttributes(node: string, attrs: Partial<NodeAttributes>): void
    replaceNodeAttributes(node: string, attrs: NodeAttributes): void

    // 属性 - 边
    getEdgeAttribute<K extends keyof EdgeAttributes>(edge: string, name: K): EdgeAttributes[K]
    getEdgeAttribute(edge: string, name: string): any
    getEdgeAttributes(edge: string): EdgeAttributes
    setEdgeAttribute<K extends keyof EdgeAttributes>(edge: string, name: K, value: EdgeAttributes[K]): void
    setEdgeAttribute(edge: string, name: string, value: any): void
    removeEdgeAttribute(edge: string, name: string): void
    mergeEdgeAttributes(edge: string, attrs: Partial<EdgeAttributes>): void
    replaceEdgeAttributes(edge: string, attrs: EdgeAttributes): void

    // 属性 - 图
    getAttribute<K extends keyof GraphAttributes>(name: K): GraphAttributes[K]
    getAttribute(name: string): any
    getAttributes(): GraphAttributes
    setAttribute<K extends keyof GraphAttributes>(name: K, value: GraphAttributes[K]): void
    setAttribute(name: string, value: any): void
    mergeAttributes(attrs: Partial<GraphAttributes>): void

    // 清理与复制
    clear(): void
    clearEdges(): void
    copy(): Graph<NodeAttributes, EdgeAttributes, GraphAttributes>
    emptyCopy(): Graph<NodeAttributes, EdgeAttributes, GraphAttributes>

    // 序列化
    toJSON(): {
      options: { multi: boolean; type: string; allowSelfLoops: boolean }
      nodes: Array<{ key: string; attributes: NodeAttributes }>
      edges: Array<{ key: string; source: string; target: string; attributes: EdgeAttributes; undirected: boolean }>
    }

    export(): {
      options: { multi: boolean; type: string; allowSelfLoops: boolean }
      nodes: Array<{ key: string; attributes: NodeAttributes }>
      edges: Array<{ key: string; source: string; target: string; attributes: EdgeAttributes; undirected: boolean }>
    }

    // 规模
    readonly order: number
    readonly size: number
    readonly directedSize: number
    readonly undirectedSize: number

    // 类型判断
    isDirected(edge: string): boolean
    isUndirected(edge: string): boolean
    type: 'mixed' | 'directed' | 'undirected'
    multi: boolean
    allowSelfLoops: boolean
  }
}
