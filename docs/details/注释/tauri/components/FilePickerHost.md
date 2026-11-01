# FilePickerHost 注释

## 职责

产品域自绘文件选择器。替换系统原生对话框（`plugin-dialog`）与全部 `<input type="file">` 入口，让「选文件 / 选目录」在磨砂巧克、新拟态等风格下与界面其余部分同材质。

三件套分工：

| 文件 | 职责 |
|---|---|
| `apps/tauri/src/components/files/FilePickerHost.vue` | 视图层：单例宿主，渲染面板与列表，绑定事件 |
| `apps/tauri/src/composables/useFilePickerBrowse.ts` | 状态机：目录读取、历史栈、过滤排序、虚拟窗口、选中与确认判定 |
| `apps/tauri/src/components/files/filePickerModel.ts` | 纯函数：路径归一、上级、面包屑、扩展名过滤、超限判定、格式化 |
| `apps/tauri/src/components/files/file-picker-host.css` | 样式：全部走 `sf-*` 角色令牌 |

## 为什么不用 TuiModal

`TuiModal` 尺寸档位固定 sm/md/lg（380/460/600），无 resize，无法承载「左轨 + 文件列表 + 状态栏」的文件选择器布局。项目文档要求「所有弹窗经 TuiModal」的约束，针对的是小表单与确认框；本组件是**大尺寸可拖宽模态**，与 `SettingsDialog`、`ImportExportModal` 同类，后者同样自建面板。

视觉配方刻意与 `settings-dialog.css` 保持一致（`--sf-modal-bg` / `--sf-overlay-edge` / `--sf-overlay-shadow` + `inset 0 1px 0 var(--sf-highlight)`），使两者并列出现时没有材质落差。

## 关键决策

- **返回绝对路径，不返回 File**：路径是磁盘上的真身，`AssetField`、`FileTreeBrowser` 可直接走 `cmd_fs_copy*` 直传（顺带修掉文件树上传用 `file.text()` 破坏二进制的问题）；需要 `File` 的存量链路用 `pathToFile()` 适配。
- **单例队列而非单弹窗**：并发调用按 FIFO 依次弹出，不吞 Promise。`settlePick(null)` 表示取消。
- **虚拟窗口复用 `computeVirtualWindow`**：与 `DataTable` 同一套数学，不另写一份。行高固定 30px（`ROW_HEIGHT` 同时供样式与计算使用，两处必须同步改）。
- **保留「用系统对话框」**：UNC 网络路径、OneDrive 云端占位文件（选中即触发下载）、超长路径、权限拒绝目录、可移除盘热拔——这些原生由 shell 免费处理，自绘不硬扛。
- **目录恒可见**：扩展名过滤器只过滤文件，目录始终显示，否则用户无法导航到目标目录。

## 约束

- 焦点与 Esc 统一由 `useFocusTrap` 承担（它自动 push/pop `modalStack`），不要再叠加 `useModalShortcuts`，否则一次 Esc 会触发两次关闭。
- 面板宽度走 `useResizable`（`panelId: 'modal-file-picker'`），与其它模态共用持久化口径。
- 新增图标只能用 `lucideMap.ts` 里已有的键名；盘符用 `cat-storage`（无 `hard-drive` 键）。
- 样式不得硬编码 `rgba()` / 固定圆角 / 固定阴影——`style:check` 会统计 rgba 出现次数并对增长报错。
