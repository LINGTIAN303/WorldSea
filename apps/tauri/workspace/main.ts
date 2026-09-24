/**
 * 工作台入口（D1-a，产品域落位）：复用旧前端主体（`../src/main`）。
 *
 * Agent 面接线（旧 AgentSpace / 数据桥 / Agent composables / @agent 与 agent-runtime 依赖）
 * 由 `vite.config.ts` 的插桩插件在构建期摘除——源码零改动、冻结面零触碰。
 * 「Agent 操作产品域」的重新设计属 D2 第二批（旧桥依赖 DOM CustomEvent，dsh 壳内无此面）。
 */
import '../src/main'
