# 联网搜索配置存储（`apps/tauri/src-tauri/src/search_config.rs`）

> 对应代码：`search_config.rs`（存储与命令）+ `search_config_tests.rs`（装配语义单测）+
> `search_commands.rs`（Provider 降级链与 `web_search` 工具）+
> `apps/tauri/src/agent/__tests__/search-config-contract.spec.ts`（跨栈契约守卫）
> 批次：档 1（2026-09-22，能力面整顿线 W3 · 断点 A）

## 一、这块为什么会断

`web_search` 有两个实现（Rust 原生 + TS 工具面），配置却有**三个断口**，串起来等于「面板能配、链路不生效」：

1. 设置面板写 localStorage `agent_search_config`（引擎）与 key-store `search_<engine>`（Key），**全仓无任何消费方**——读它的只有面板自己回填输入框那一行。
2. Rust 侧启动把降级链固定成 `SearchConfig::default()`（三键全 `None`），链上永远只剩 DuckDuckGo 免 Key 兜底。
3. 注入口 `set_search_config` 存在但无调用方，且只改内存不落盘——即使调了，重启即失。

净效果：三个需 Key 的引擎（Tavily / Bing / SerpAPI）是**纸面能力**。

**为什么长期无人发现**：两侧测试各自恒绿——Rust 测装配（mock 链，不碰配置来源），前端测面板状态（写进 localStorage 就算过），中间的「命令名 + 字段名」没人核对。这类缝只能靠**跨栈守卫**堵，见 §四。

## 二、设计决策

### 1. 配置读写收口到后端单点，照 A2 语义检索先例

同一形状在仓库里已有实现（`semantic_commands.rs`：偏好落 JSON + Key 落 SecureStore + 启动 `load_into_shared` + 视图不回传明文）。本模块逐条对齐：

| 决策 | 取法 | 被否掉的替代 |
|---|---|---|
| 事实源 | Rust 单写（`search_config.json` + `secure_store.db`） | 前端持 Key、Rust 同名直读——Keyring 不可用时 Key 落 localStorage AES 密文，Rust 读不到，**静默不生效的死角原样保留** |
| Key 出界面 | 视图只回 `*KeySet` 布尔 + `providerOrder` | 回传明文给渲染进程供输入框回显——扩大泄漏面，且 A2 已确立「不回传」口径 |
| 写入口 | `cmd_search_config_get/set` 双传输（Tauri + HTTP RPC）注册 | 保留 `set_search_config` 作运行时旁路——与存储成**双写路径**，且旁路不持久化 |
| 生效时机 | 保存即 `set_config` + 启动即 `load_into_chain` | 只启动加载——改完要重启，正是 A2 明确避开的坑 |

### 2. 只装配「当前引擎」的 Key

`assemble()` 把选中引擎那一个槽位的 Key 交给链，其余引擎即便存有 Key 也不带上。

理由：链的顺位规则是「有 Key 的排前」。若把所有已存 Key 都交给链，用户从 Tavily 切到 Bing 后，**存着的 Tavily Key 会悄悄继续顶在第一顺位**，面板上的引擎选择失去意义。副作用是可接受的取舍：Tavily 失败时不再自动试 Bing，而是直接降 DuckDuckGo——**降级链保「有没有结果」，不保「用哪家」**，与「用户选了谁」这条更强的约束分开。

引擎不可选时（如直传 `duckduckgo`）不产生任何 Key 槽位，装配结果为空 = 只走兜底。未知引擎名**报错不回落到缺省**（回落会让「拼错引擎」变成「静默换引擎」）。

### 3. 前端语义：非空才覆盖 + 显式清除

`apiKey` 沿用 A2 口径：非空才写，空串 = 保持不变；清除走 `clearApiKey`。因此面板把 Key 输入从**逐键 `@input`** 改为 **`@change` 提交**（逐键会每个字符写一次库并重建一次链），并新增「清除」按钮承载被删掉的旧语义（旧版「清空输入框即删 Key」）。

这是本批唯一新增的控件，取代表述：**旧语义会误删**（用户想「不改动」而留空时）。

## 三、踩坑约束

- **State 取键必须是 `Arc<T>`**：`manage` 的是 `Arc<SearchConfigStore>`，命令签名与 RPC 的 `app.state::<...>()` 两侧类型要一致，取裸类型直接 panic（`secure_store.rs` 头注记的 2026-08-29 存量 bug 同源）。
- **初始化顺序**：store 需要 `SecureStore`，而 `semantic_commands` 会**移走** `secure_store`，所以搜索块必须排在语义块之前（或用 clone）。
- **`search_config.json` 落 `app_data/worldsea/`**（与 `semantic.json` 同目录）；写前先 `create_dir_all`，配置缺失/损坏一律回落默认而非报错——启动路径不该因偏好文件而失败。
- **非法引擎不落盘也不动链**：`apply_patch` 先校验后写，`assemble` 只在末尾 `set_config`，避免报错路径留下半成品配置（有对应用例锁定）。
- **`ordered_provider_ids()` 不含 Key**：它是给面板和守卫看的「现在真的会先打谁」，任何形状变化都会牵动跨栈守卫。

## 四、跨栈守卫的断言方向

`search-config-contract.spec.ts` 是**纯源码扫描**（不导入被测模块，避免 jsdom 拉起 Vue/Tauri 运行时），断言方向统一为「以 Rust 侧定义为准，要求前端跟齐」：

| 守住什么 | 变异即报红 |
|---|---|
| 两命令在 Tauri handler 与 RPC 双侧注册 | 只在一侧注册（Web 模式静默失败） |
| 面板 `invoke<...>('cmd_…')` 的命令名 ⊆ 后端注册集 | 命令改名 / 拼错 |
| `settings` 载荷字段 ⊆ `SearchSettingsPatch` 字段 | Rust 改字段名而前端未跟 |
| `SearchSettingsView` 字段 == 面板 DTO 字段 | 任一侧增删字段 |
| 视图字段不得以 `key` 结尾（只可 `*KeySet`） | 有人加回明文回传 |
| lib.rs 含 `load_into_chain()` 且 store 与工具共用同一 `search_chain` | **摘掉启动加载**（本批修的就是它） |
| 前端无 `agent_search_config` / `search_` key-store 写法 | 旧野路径复活 |
| 无 `set_search_config` 注册 | 运行时旁路复活 |

本批实测四层变异全部按预期报红并复原复跑（输出留档 `.workbuddy/_inj/`）。

## 五、已知边界（不在本批）

- **TS 侧重复实现仍在**（`packages/agent-runtime/src/tools/web-search.ts`，Smart Fill 与网页模式用），其 `getSearchConfig` 仍是空桩 → 该路径只有 DuckDuckGo。要不要退役这份实现属架构裁定（断点 D）。
- **只搜不读**：`web_fetch` 只在 TS 工具面，桌面主链既无原生实现也不在任何场景白名单，而 TS 版 `web_search` 描述仍引导模型「深入请用 web_fetch」（断点 C）。
- Key 从前端迁到后端属**破坏性口径**：旧 `search_<engine>` 条目不再被读取。按项目约定无需考虑存量用户数据迁移。
