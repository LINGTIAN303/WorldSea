/**
 * 工作台入口（D1-a，产品域落位）：复用旧前端主体（`../src/main`）。
 *
 * Agent 面接线（旧 AgentSpace / 数据桥 / Agent composables / @agent 与 agent-runtime 依赖）
 * 由 `vite.config.ts` 的插桩插件在构建期摘除——源码零改动、冻结面零触碰。
 * 「Agent 操作产品域」的重新设计属 D2 第二批（旧桥依赖 DOM CustomEvent，dsh 壳内无此面）。
 *
 * 双 Cordis Spike（2026-09-25）：`localStorage['ws:cordis-spike'] === '1'` 时在**本页**加挂第二棵
 * Cordis 树（验证用，默认 inert；见 `./spike/cordis-spike.ts`）。放在 `../src/main` 之后引入——
 * 那时 pinia 已激活，插件才能注册进产品壳。
 *
 * 能力桥（A，2026-09-25）：本页是**世界语义提供方**——把内建能力（world.views.list /
 * world.project.current）登记到壳，并装伺服入口 `__WORLDSEA_CAPABILITY_CALL__`；
 * Agent 面（主窗）经壳 `cmd_capability_invoke` 调用（见 `../src/shell/capabilities.ts`）。
 */
import '../src/main'
import { installWorldCapabilities } from '../src/shell/capabilities'

installWorldCapabilities()

if (localStorage.getItem('ws:cordis-spike') === '1') {
  void import('./spike/cordis-spike')
    .then(m => m.startCordisSpike())
    .catch(error => console.error('[cordis-spike] 启动失败:', error))
}
