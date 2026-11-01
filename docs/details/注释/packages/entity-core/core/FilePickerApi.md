# FilePickerApi 注释

## 职责

自绘文件选择器的**注入接口**。接口定义在 entity-core，UI 实现在 `apps/tauri`，启动链注册缝合。

```mermaid
flowchart LR
  A["调用点<br/>entity-core / plugin-sdk / ui-kit / apps"] -->|getFilePickerApi().pick| B["entity-core<br/>FilePickerApi.ts"]
  C["apps/tauri<br/>composables/filePickerApi.ts"] -.register.-> B
  C --> D["队列"]
  D --> E["FilePickerHost.vue"]
```

## 为什么接口在 entity-core

三个硬约束：

1. `entity-core` 在 `architecture-policy.json` 的 `requires` 白名单只有 `core-api-types`、`perf-kit`——**不能依赖 ui-kit**，所以接口不能和 UI 放一起。
2. 调用点有 3 处在 packages 内（`plugin-sdk/ImageField.vue`、`ui-kit/ImportExportModal.vue`、`ui-kit/AppearancePanel.vue`），packages **不能依赖 apps**。
3. 剩余调用点在 entity-core（`assetImport.ts`、`ProjectFS.ts`）与 apps 内，同样需要同一入口。

接口下沉到 entity-core 后，四层调用方共用一个入口，UI 只在 apps 注册一次，无需放宽任何依赖白名单。

## 未注册的失败策略

返回 `nullPicker`（`pick` 恒返回 `null`），调用方按「用户取消」处理。

这与 `ProjectSwitcherApi` 的「返回 `null` + 消费方抛错」不同，是刻意选择：后者因启动链从未调用 `registerProjectSwitcherApi`，导致 `importProjectFromDir` 长期不可达（见 `docs/details/注释/packages/entity-core/core/ProjectFS.md`）。注入接口用 noop 兜底，避免同样的死钩子。

## pathToFile 的边界

| 场景 | 处理 |
|---|---|
| ≤ 30MB | base64 经 `cmd_fs_read` 读回，包装为 `File` |
| > 30MB | 返回 `null` 并告警——改用 `pathToArrayBuffer` 或路径直传 |

30MB 来自 `PATH_FILE_MAX_BYTES`（base64 IPC 会内存放大）。该常量在 `pathToFile.ts` 内**独立声明**，不 import `assetImport.ts` 的 `FILE_LINK_MAX_BYTES`——反向 import 会让 mock `assetImport` 的测试因缺导出而失败，且两模块无实质依赖。

## 两条读取通道

| 函数 | 通道 | 上限 | 适用 |
|---|---|---|---|
| `pickLocalFiles` / `pathToFile` | `cmd_fs_read` base64 IPC | 30MB | 图片、图标、正文插图 |
| `pickLocalBuffers` / `pathToArrayBuffer` | asset 协议（`convertFileSrc` → `fetch`） | 无（协议层流式） | 字体包 200MB、视频 1GB |

asset 通道依赖 `tauri.conf.json` 的 `assetProtocol.scope`（当前 `**`）。它绕开的是 IPC 的字符串编解码，不是文件系统本身。

## MIME 推断

`MIME_BY_EXT` 只覆盖项目内实际会选的类型（图片、文本、字体）。未知扩展名归 `application/octet-stream`——不做系统级 MIME 查询，因为那需要额外的 Rust 命令，而文件头嗅探对存量链路没有收益。

## 约束

- `pathToFile.ts` 依赖 `assetImport.ts` 的 `FILE_LINK_MAX_BYTES`，但 `assetImport.ts` 反向依赖 `FilePickerApi`——两者不能互相 import，否则成环。当前方向是 `pathToFile → assetImport`，单向。
- 新增调用点时用 `getFilePickerApi().pick()`，不要直接 import `@tauri-apps/plugin-dialog`（那样会绕过自绘层，也丢失注入能力）。
- 需要系统对话框作为逃生口时，由 `FilePickerHost` 内部提供按钮，不要在下游另开一个。
