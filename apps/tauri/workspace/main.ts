/**
 * 工作台入口（D1-a，产品域落位）：复用旧前端主体（`../src/main`）。
 *
 * Agent 面接线（旧 AgentSpace / 数据桥 / Agent composables / @agent 与 agent-runtime 依赖）
 * 由 `vite.config.ts` 的插桩插件在构建期摘除——源码零改动、冻结面零触碰。
 * 「Agent 操作产品域」的重新设计属 D2 第二批（旧桥依赖 DOM CustomEvent，dsh 壳内无此面）。
 *
 * 能力桥（A，2026-09-25）：本页是**世界语义提供方**——把内建能力（world.views.list /
 * world.project.current）登记到壳，并装伺服入口 `__WORLDSEA_CAPABILITY_CALL__`；
 * Agent 面（主窗）经壳 `cmd_capability_invoke` 调用（见 `../src/shell/capabilities.ts`）。
 *
 * 第二棵树（B，2026-09-25）：`startWorldTree()` 在**本页**起 WorldSea 自己的 Cordis 树
 * （世界语义，与 dsh 对等；cordis 依赖自 vendor，见 `../src/world/vendor/README.md`）。
 * 放在 `../src/main` 之后起树——视图注册走真源事件，`viewSync` 装配时会做一次对账，
 * 故先后顺序不影响显示侧一致。
 */
import '../src/main'
import { installWorldCapabilities } from '../src/shell/capabilities'
import { startWorldTree } from '../src/world'

installWorldCapabilities()

void startWorldTree().catch(error => console.error('[world-tree] 启动失败:', error))

if (localStorage.getItem('ws:cordis-spike') === '1') {
  void import('../src/world/dev/probe')
    .then(m => m.installViewsProbe())
    .catch(error => console.error('[world-tree] 探针装配失败:', error))
}
