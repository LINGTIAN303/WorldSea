# THIRD-PARTY-NOTICES — 第三方组件许可声明

WorldSea 使用了以下第三方开源组件，均依其自身许可条款分发，版权归各自作者所有。
本文件为汇总与致谢；各组件的**完整许可文本与版权声明以包内随附的 LICENSE / 文件为准**，
本表与包内声明冲突时以包内声明为准。

> WorldSea 本体依 [MIT License](LICENSE) 分发（Copyright (c) 2026 LINGTIAN303）。
> 对于「Apache-2.0 OR MIT」类双许可组件，本仓库一律按 **MIT 选项**使用；
> 仅以 Apache-2.0 许可的组件，随分发保留其原始许可与版权声明。

**版本口径**：本表不锁定具体版本号，实际随分发版本的组件清单与版本以
`pnpm-lock.yaml`、`apps/tauri/src-tauri/Cargo.lock` 为准。

---

## 一、Vendored 项目（源码随本仓库分发）

### dsh — `@deepseek-ai/dsh-root`

- 许可：MIT；版权：Copyright (c) 2026 DeepSeek
- 来源：https://github.com/deepseek-ai/dsh
- 说明：WorldSea 的插件宿主基于 dsh 的 vendored 副本运行。本仓库包含本地补丁
  （`dsh/patches/`）与对账脚本（`scripts/check-dsh-fork-ledger.mjs`）；
  上游原始版权声明保留于 `dsh/LICENSE`。

### dsh/vendor 内嵌子包

cordis · cosmokit · schemastery · group · hmr · include · loader · logger-console · timer
- 许可：均为 MIT（各子包内附 LICENSE）
- 说明：dsh 上游依赖的 Koishi 生态基础库，随 dsh 一并 vendored。

## 二、前端依赖（npm，随应用打包分发）

### MIT（版权声明见各包）

| 包 | 用途 |
|----|------|
| vue · pinia | 应用框架与状态 |
| naive-ui | 基础组件库 |
| @tiptap/core · @tiptap/pm · @tiptap/vue-3 · @tiptap/starter-kit · @tiptap/extension-image · @tiptap/extension-mention · @tiptap/extension-table · @tiptap/suggestion | 富文本编辑（依赖树含 prosemirror-* 系列，均为 MIT） |
| codemirror · @codemirror/autocomplete · @codemirror/commands · @codemirror/language · @codemirror/lint · @codemirror/merge · @codemirror/search · @codemirror/state · @codemirror/view · @codemirror/legacy-modes · @codemirror/lang-*（cpp/css/go/html/java/javascript/json/markdown/php/python/rust/sql/vue/yaml） | 代码编辑器 |
| @lezer/highlight | 语法高亮基础 |
| codemirror-languageserver | **BSD-3-Clause** |
| @replit/codemirror-minimap · vue-codemirror | 编辑器扩展 |
| vscode-jsonrpc · vscode-languageserver-protocol · vscode-languageserver-types | LSP 协议 |
| @xterm/xterm · @xterm/addon-fit | 终端模拟 |
| @tabler/icons-vue · @lobehub/icons-static-svg · lucide-vue-next（ISC） | 图标 |
| marked · turndown · dompurify（(MPL-2.0 OR Apache-2.0)） | Markdown/HTML 处理 |
| mind-elixir | 思维导图 |
| graphology · graphology-layout · graphology-layout-forceatlas2 · sigma | 图分析与渲染 |
| docx · docx-preview（Apache-2.0） | Word 文档生成/预览 |
| gpt-tokenizer · js-yaml · vuedraggable · @chenglou/pretext | 工具库 |

### Apache-2.0

echarts · dexie · pdfjs-dist · xlsx（SheetJS CE，https://sheetjs.com） · jszip（依
「MIT OR GPL-3.0-or-later」双许可按 MIT 选项使用）

### 其他许可

mammoth（BSD-2-Clause） · d3-force（ISC）

### 开发期工具（不随应用分发，仅列代表性项）

typescript · vite · vitest · @vitejs/plugin-vue · vue-tsc · jsdom · fake-indexeddb ·
@vue/test-utils · rollup-plugin-visualizer · vite-plugin-compression2 · vite-plugin-wasm ·
storybook · @tauri-apps/cli

## 三、Rust 依赖（Cargo，直接依赖）

| crate | 许可 |
|-------|------|
| tauri（及 tauri-build/tauri-macros/tauri-codegen/tauri-utils 等 tauri 系） | Apache-2.0 OR MIT |
| serde · serde_json · windows / windows-core 系 | Apache-2.0 OR MIT |
| winreg | MIT |
| dirs | MIT OR Apache-2.0 |

## 四、字体

| 字体 | 许可 | 分发位置 |
|------|------|----------|
| Montserrat | SIL Open Font License 1.1 | 安装器界面字体（woff2） |
| @windfonts/chinese-fonts | 逐字体声明（OFL / MIT / Apache-2.0 混合） | 应用内中文字体；各字体的许可类型与使用权利由包内 API（`getLicenseType` / `getLicenseUrl` / `getUsageRights`）与随附说明提供 |

## 五、上游未声明许可的组件

| 组件 | 说明 |
|------|------|
| segmentit（中文分词） | 上游 package.json 与 npm registry 元数据均未设置 license 字段。使用前请自行向上游仓库确认；若上游后续补充声明，以新声明为准 |

---

*本文件由维护者人工整理；依赖变更时请同步更新。整理日期：2026-10-10。*
