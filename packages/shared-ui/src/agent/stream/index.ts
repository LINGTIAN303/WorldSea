/**
 * stream：Agent 输出事件行流渲染引擎（统一扁平形态，Phase 2）
 *
 * 取消 deep/normal/explore 模式分叉，每类事件一个 keyed 行组件：
 * user（右对齐气泡）/ assistant（正文行，ws-agent-md）/ think（动态折叠推理）/
 * tool（扁平单行，展开详情）/ divider（时间/轮次分隔线）。
 */
// 副作用：统一行样式 + Prism 代码高亮注入（行内 Markdown 代码块需用）
import './stream.css'
import '../bubbles/codeHighlight'
// 副作用：全 5 类行组件注册
export * from './rows'
// 列表渲染容器（纯行渲染，不负责窗口化）
export { default as AgentStreamList } from './AgentStreamList.vue'