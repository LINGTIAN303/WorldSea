<template>
  <div class="set-overlay" v-if="show" @click.self="close">
    <div class="set-shell">
      <div class="set-topbar">
        <div class="set-topbar-left">
          <WsIcon name="settings" size="sm" />
          <span class="set-topbar-title">设置</span>
        </div>
        <div class="set-search-wrap">
          <svg class="set-search-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6.5" cy="6.5" r="5"/><path d="M10.5 10.5L15 15"/></svg>
          <input type="text" class="set-search-input" v-model="searchQuery" placeholder="搜索设置..." />
          <button v-if="searchQuery" class="set-search-clear" @click="searchQuery = ''">✕</button>
        </div>
        <div class="set-topbar-spacer"></div>
        <button class="set-close" @click="close">✕</button>
      </div>

      <nav class="set-tabs">
        <button v-for="cat in categories" :key="cat.id"
          class="set-tab" :class="{ active: activeSection === cat.id }"
          @click="onTabClick(cat.id)">
          <WsIcon :name="cat.icon" size="xs" class="stb-icon" />
          <span class="stb-label">{{ cat.label }}</span>
        </button>
      </nav>

      <div class="set-cards" v-if="activeSection || searchQuery">
        <template v-if="searchQuery">
          <template v-for="cat in matchedCategories" :key="cat.id">
            <template v-if="cat.id === 'appearance'">
              <div v-show="match('主题 theme 外观 深色 浅色 极光 锻造 水墨 棱镜 宇宙 编辑器')" class="set-card">
                <div class="sc-head">主题</div>
                <div class="set-theme-row">
                  <button v-for="t in themes" :key="t.id" class="set-theme-btn" :class="{ on: currentThemeId === t.id }" @click="onThemeChange(t.id)">
                    <WsIcon :name="t.icon" size="md" class="st-icon" />
                    <span class="st-label">{{ t.label }}</span>
                  </button>
                </div>
                <button class="set-theme-editor-btn" @click="openThemeEditor">
                  <WsIcon name="theme-editor" size="xs" /> 主题编辑器
                </button>
              </div>
              <div v-show="match('高亮 highlight 脉冲 动画 淡化 扩散 透明度')" class="set-card">
                <div class="sc-head">高亮</div>
                <div class="set-row"><span>脉冲动画</span><label class="set-toggle"><input type="checkbox" v-model="store.highlight_pulseEnabled" /><span class="set-toggle-slider"></span></label></div>
                <div class="set-row"><span>启用淡化</span><label class="set-toggle"><input type="checkbox" v-model="store.highlight_dimmingEnabled" /><span class="set-toggle-slider"></span></label></div>
                <div v-if="store.highlight_dimmingEnabled" class="set-row"><span>淡化模式</span><select v-model="store.highlight_dimmingMode" class="set-select"><option value="simple">简单淡化</option><option value="spread">关系扩散</option></select></div>
                <div v-if="store.highlight_dimmingEnabled" class="set-row"><span>淡化透明度</span><div class="set-range-wrap"><input type="range" min="0.1" max="0.5" step="0.05" v-model.number="store.highlight_dimOpacity" class="set-range" /><span class="set-range-val">{{ store.highlight_dimOpacity }}</span></div></div>
                <div v-if="store.highlight_dimmingEnabled && store.highlight_dimmingMode === 'spread'" class="set-row"><span>扩散跳数</span><select v-model.number="store.highlight_spreadHops" class="set-select"><option :value="1">1 跳</option><option :value="2">2 跳</option><option :value="3">3 跳</option></select></div>
              </div>
            </template>
            <template v-if="cat.id === 'plugins'">
              <div v-show="match('插件 plugin 启用 禁用')" class="set-card">
                <div class="sc-head">插件管理</div>
                <div class="set-plugin-search"><input type="text" v-model="pluginSearch" placeholder="搜索插件..." class="set-input" /></div>
                <draggable v-if="!pluginSearch" :list="pluginList" item-key="id" ghost-class="sp-ghost" drag-class="sp-drag" handle=".sp-grip" @end="onPluginDragEnd" class="set-plugin-list">
                  <template #item="{ element: p }">
                    <div class="set-plugin-item">
                      <span class="sp-grip" title="拖拽排序"><WsIcon name="grip" size="xs" /></span>
                    <span v-if="p.source" class="sp-source">{{ p.source === 'builtin' ? '内置' : p.source === 'local' ? '本地' : '远程' }}</span>
                    <label class="sp-toggle"><input type="checkbox" :checked="p.active" @change="onPluginToggle(p.id)" /><span class="sp-icon"><WsIcon v-if="hasIcon(p.icon)" :name="p.icon" size="sm" /><span v-else>{{ p.icon }}</span></span><span class="sp-label">{{ p.label }}</span></label>
                  </div>
                </template>
              </draggable>
              <div v-else class="set-plugin-list">
                <div v-for="p in filteredPlugins" :key="p.id" class="set-plugin-item">
                    <span v-if="p.source" class="sp-source">{{ p.source === 'builtin' ? '内置' : p.source === 'local' ? '本地' : '远程' }}</span>
                    <label class="sp-toggle"><input type="checkbox" :checked="p.active" @change="onPluginToggle(p.id)" /><span class="sp-icon"><WsIcon v-if="hasIcon(p.icon)" :name="p.icon" size="sm" /><span v-else>{{ p.icon }}</span></span><span class="sp-label">{{ p.label }}</span></label>
                  </div>
                </div>
              </div>
            </template>
            <template v-if="cat.id === 'editor'">
              <div v-show="match('撤销 重做 undo redo 历史')" class="set-card">
                <div class="sc-head">撤销 / 重做</div>
                <div class="set-row"><span>撤销历史条数</span><input type="number" class="set-input set-input-sm" :value="store.undoHistoryLimit" min="5" max="100" @input="onUndoLimitChange" /></div>
                <div class="set-row"><span>多步重做</span><label class="set-toggle"><input type="checkbox" :checked="store.multiStepRedo" @change="store.multiStepRedo = ($event.target as HTMLInputElement).checked" /><span class="set-toggle-slider"></span></label></div>
                <div class="set-hint">关闭后 {{ formatKeyForDisplay('ctrl') }}+Y 仅重做一步</div>
              </div>
              <div v-show="match('大纲 outline 内嵌 编辑')" class="set-card">
                <div class="sc-head">大纲</div>
                <div class="set-row"><span>内嵌编辑</span><label class="set-toggle"><input type="checkbox" v-model="store.outlineInlineEdit" /><span class="set-toggle-slider"></span></label></div>
                <div class="set-hint">启用后，大纲节点详情面板底部显示文本编辑区</div>
              </div>
              <div v-show="match('光标 caret 平滑 smooth')" class="set-card">
                <div class="sc-head">光标</div>
                <div class="set-row"><span>平滑光标</span><label class="set-toggle"><input type="checkbox" v-model="store.smoothCaretEnabled" /><span class="set-toggle-slider"></span></label></div>
                <template v-if="store.smoothCaretEnabled">
                  <div class="set-row"><span>动画时长 (ms)</span><input type="number" class="set-input set-input-sm" v-model.number="store.smoothCaretDuration" min="50" max="500" step="10" /></div>
                  <div class="set-row"><span>光标样式</span><select v-model="store.smoothCaretVariant" class="set-select"><option value="line">竖线</option><option value="block">方块</option><option value="underline">下划线</option></select></div>
                </template>
              </div>
            </template>
            <template v-if="cat.id === 'layout'">
              <div v-show="match('思维导图 mindmap 中心 节点')" class="set-card">
                <div class="sc-head">思维导图</div>
                <div class="set-row"><span>中心节点上限</span><input type="number" class="set-input set-input-sm" :value="store.maxCenterNodes" min="1" max="20" @input="onMaxCenterNodesChange" /></div>
              </div>
              <div v-show="match('面板 panel 布局 宽度 侧边栏 位置 左右 sidebar 实体 详情 panel detail position')" class="set-card">
                <div class="sc-head">面板布局</div>
                <div class="set-row"><span>启用自定义视窗数量上限</span><label class="set-toggle"><input type="checkbox" :checked="store.panelLimitEnabled" @change="store.panelLimitEnabled = ($event.target as HTMLInputElement).checked" /><span class="set-toggle-slider"></span></label></div>
                <div class="set-row"><span>插件侧边栏位置</span>
                  <div class="set-chip-group">
                    <label class="set-chip" :class="{ on: store.sidebarPosition === 'left' }">
                      <input type="radio" name="sidebarPos" value="left" v-model="store.sidebarPosition" /> 左侧
                    </label>
                    <label class="set-chip" :class="{ on: store.sidebarPosition === 'right' }">
                      <input type="radio" name="sidebarPos" value="right" v-model="store.sidebarPosition" /> 右侧
                    </label>
                  </div>
                </div>
                <div class="set-row"><span>实体详情面板位置</span>
                  <div class="set-chip-group">
                    <label class="set-chip" :class="{ on: store.detailPanelPosition === 'left' }">
                      <input type="radio" name="detailPos" value="left" v-model="store.detailPanelPosition" /> 左侧
                    </label>
                    <label class="set-chip" :class="{ on: store.detailPanelPosition === 'right' }">
                      <input type="radio" name="detailPos" value="right" v-model="store.detailPanelPosition" /> 右侧
                    </label>
                  </div>
                </div>
                <div v-if="panelWidths.length > 0" class="set-panel-widths">
                  <div v-for="pw in panelWidths" :key="pw.panelId" class="spw-row"><span class="spw-label">{{ panelLabel(pw.panelId) }}</span><span class="spw-value">{{ pw.width }}px</span><button class="spw-reset" @click="onResetPanelWidth(pw.panelId)">↺</button></div>
                  <button class="set-btn" @click="resetAllWidths">重置所有面板宽度</button>
                </div>
              </div>
              <div v-show="match('字段 field 预设 布局 重置')" class="set-card">
                <div class="sc-head">字段布局预设</div>
                <div class="set-hint">重置后恢复插件原始字段顺序，删除所有自定义字段和用户预设</div>
                <div class="set-btn-row">
                  <button class="set-btn" @click="resetFieldPresets">重置所有字段预设</button>
                  <button class="set-btn set-btn-danger" @click="resetCustomFields">清除所有自定义字段</button>
                </div>
              </div>
              <div v-show="match('时间线 timeline 拖拽 泳道 甘特图 紧凑 分组')" class="set-card">
                <div class="sc-head">时间线</div>
                <div class="set-row"><span>拖拽改时间</span><label class="set-toggle"><input type="checkbox" v-model="store.timelineDragEnabled" /><span class="set-toggle-slider"></span></label></div>
                <div class="set-hint">启用后可在水平模式中拖拽事件条形修改日期</div>
                <div class="set-row"><span>默认布局模式</span><select v-model="store.timelineDefaultMode" class="set-select"><option value="vertical">垂直时间线</option><option value="horizontal">水平甘特图</option></select></div>
                <div class="set-row"><span>默认泳道分组</span><select v-model="store.timelineDefaultGroup" class="set-select"><option value="none">无分组</option><option value="character">按角色</option><option value="location">按地点</option><option value="era">按纪元</option><option value="tag">按标签</option></select></div>
                <div class="set-row"><span>紧凑模式</span><label class="set-toggle"><input type="checkbox" v-model="store.timelineCompactMode" /><span class="set-toggle-slider"></span></label></div>
                <div class="set-hint">垂直模式下使用紧凑卡片布局</div>
              </div>
            </template>
            <template v-if="cat.id === 'relations'">
              <div v-show="match('关系 relation 自动 创建 实体')" class="set-card">
                <div class="sc-head">关系</div>
                <div class="set-row"><span>自动创建实体提示</span><label class="set-toggle"><input type="checkbox" v-model="store.autoCreateEntityEnabled" /><span class="set-toggle-slider"></span></label></div>
                <template v-if="store.autoCreateEntityEnabled">
                  <div class="set-row set-row-sub"><span>关系选择器中触发</span><label class="set-toggle"><input type="checkbox" v-model="store.autoCreateSelectorEnabled" /><span class="set-toggle-slider"></span></label></div>
                  <div class="set-row set-row-sub"><span>实体引用字段中触发</span><label class="set-toggle"><input type="checkbox" v-model="store.autoCreateEntityRefEnabled" /><span class="set-toggle-slider"></span></label></div>
                  <div class="set-row set-row-sub"><span>图谱视图中触发</span><label class="set-toggle"><input type="checkbox" v-model="store.autoCreateGraphEnabled" /><span class="set-toggle-slider"></span></label></div>
                </template>
              </div>
            </template>
            <template v-if="cat.id === 'video'">
              <div v-show="match('陪伴模式 video 启用 开关 空间 静默')" class="set-card">
                <div class="sc-head">陪伴模式</div>
                <div class="set-row"><span>启用陪伴模式</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeEnabled" /><span class="set-toggle-slider"></span></label></div>
                <div class="set-hint">编辑实体时，AI 以角色身份弹出通知评论</div>
                <div class="set-row"><span>Agent 空间内静默</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeSilentInSpace" /><span class="set-toggle-slider"></span></label></div>
                <div class="set-hint">在 Agent 空间中不触发陪伴模式通知</div>
              </div>
              <div v-show="match('弹窗 持续 时间 duration 防抖 超时')" class="set-card">
                <div class="sc-head">触发与弹窗</div>
                <div class="set-row"><span>弹窗持续时间（秒）</span><div class="set-range-wrap"><input type="range" min="3" max="15" step="1" v-model.number="store.companionModeDuration" class="set-range" /><span class="set-range-val">{{ store.companionModeDuration }}s</span></div></div>
                <div class="set-row"><span>防抖等待（秒）</span><div class="set-range-wrap"><input type="range" min="2" max="15" step="1" v-model.number="store.companionModeDebounce" class="set-range" /><span class="set-range-val">{{ store.companionModeDebounce }}s</span></div></div>
                <div class="set-row"><span>LLM 超时（秒）</span><div class="set-range-wrap"><input type="range" min="1" max="10" step="1" v-model.number="store.companionModeTimeout" class="set-range" /><span class="set-range-val">{{ store.companionModeTimeout }}s</span></div></div>
                <div class="set-row"><span>连续失败上限</span><div class="set-range-wrap"><input type="range" min="1" max="10" step="1" v-model.number="store.companionModeMaxFailures" class="set-range" /><span class="set-range-val">{{ store.companionModeMaxFailures }}次</span></div></div>
                <div class="set-row"><span>停顿触发阈值（秒）</span><div class="set-range-wrap"><input type="range" min="1" max="5" step="0.5" v-model.number="store.companionModePauseThreshold" class="set-range" /><span class="set-range-val">{{ store.companionModePauseThreshold }}s</span></div></div>
                <div class="set-row"><span>断句触发</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeSentenceTrigger" /><span class="set-toggle-slider"></span></label></div>
                <div class="set-row"><span>字数触发阈值</span><div class="set-range-wrap"><input type="range" min="5" max="50" step="5" v-model.number="store.companionModeCharThreshold" class="set-range" /><span class="set-range-val">{{ store.companionModeCharThreshold }}字</span></div></div>
              </div>
              <div v-show="match('人格 persona 跨插件 角色 附体 切换 概率')" class="set-card">
                <div class="sc-head">人格设置</div>
                <div class="set-row"><span>人格过渡动画</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModePersonaTransition" /><span class="set-toggle-slider"></span></label></div>
                <div class="set-row"><span>跨插件人格附体</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeCrossPlugin" /><span class="set-toggle-slider"></span></label></div>
                <div class="set-hint">编辑非生命体实体时，AI 可能以角色/种族/势力的人格说话</div>
                <div v-if="store.companionModeCrossPlugin" class="set-row set-row-sub"><span>人格切换概率</span><div class="set-range-wrap"><input type="range" min="0" max="100" step="5" v-model.number="store.companionModePersonaSwitchChance" class="set-range" /><span class="set-range-val">{{ store.companionModePersonaSwitchChance }}%</span></div></div>
              </div>
              <div v-show="match('概率 luck 运气 活跃 沉默')" class="set-card">
                <div class="sc-head">概率体系</div>
                <div class="set-row"><span>全局运气</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeLuckEnabled" /><span class="set-toggle-slider"></span></label></div>
                <div class="set-hint">启用后，AI 会经历"活跃期"和"沉默期"，表现更自然</div>
                <template v-if="store.companionModeLuckEnabled">
                  <div class="set-row set-row-sub"><span>运气重置周期（分钟）</span><div class="set-range-wrap"><input type="range" min="3" max="15" step="1" v-model.number="store.companionModeLuckResetMinutes" class="set-range" /><span class="set-range-val">{{ store.companionModeLuckResetMinutes }}分</span></div></div>
                  <div class="set-row set-row-sub"><span>运气重置操作数</span><div class="set-range-wrap"><input type="range" min="5" max="30" step="1" v-model.number="store.companionModeLuckResetOps" class="set-range" /><span class="set-range-val">{{ store.companionModeLuckResetOps }}次</span></div></div>
                </template>
              </div>
              <div v-show="match('场景 scene 概率 probability 触发')" class="set-card">
                <div class="sc-head">场景概率</div>
                <div class="set-hint" style="margin-bottom:8px">每种操作场景的独立触发概率</div>
                <div v-for="sp in sceneProbItems" :key="sp.id" class="set-row">
                  <span>{{ sp.label }}</span>
                  <div class="set-range-wrap"><input type="range" min="0" max="100" step="5" :value="store.companionModeSceneProbs[sp.id] ?? sp.defaultVal" @input="onSceneProbChange(sp.id, $event)" class="set-range" /><span class="set-range-val">{{ store.companionModeSceneProbs[sp.id] ?? sp.defaultVal }}%</span></div>
                </div>
              </div>
              <div v-show="match('弹窗 位置 场景化 停驻 pin 点击')" class="set-card">
                <div class="sc-head">弹窗交互</div>
                <div class="set-row"><span>弹窗位置场景化</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModePositionContext" /><span class="set-toggle-slider"></span></label></div>
                <div class="set-hint">根据操作场景自动调整弹窗出现位置</div>
                <div class="set-row"><span>点击停驻</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeClickPin" /><span class="set-toggle-slider"></span></label></div>
                <div class="set-hint">点击弹窗可停驻并查看历史消息</div>
              </div>
              <div v-show="match('独立 模型 model 供应商 provider')" class="set-card">
                <div class="sc-head">模型配置</div>
                <div class="set-row"><span>使用独立模型</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeCustomModel" /><span class="set-toggle-slider"></span></label></div>
                <div class="set-hint">关闭时跟随主模型配置；开启后从已配置的供应商中选择</div>
                <template v-if="store.companionModeCustomModel">
                  <div class="set-row set-row-sub"><span>供应商</span>
                    <select v-model="store.companionModeProviderKey" class="set-select">
                      <option value="" disabled>选择供应商</option>
                      <option v-for="p in companionProviderList" :key="p.key" :value="p.key">{{ p.label }}</option>
                    </select>
                  </div>
                  <template v-if="store.companionModeProviderKey">
                    <div class="set-row set-row-sub"><span>模型</span>
                      <div class="cp-model-field">
                        <select v-if="companionCurrentModels.length > 0" v-model="store.companionModeModelId" class="set-select">
                          <option value="" disabled>选择模型</option>
                          <option v-for="m in companionCurrentModels" :key="m.id" :value="m.id">{{ m.name }}</option>
                        </select>
                        <input v-else type="text" v-model="store.companionModeModelId" class="set-input" placeholder="输入模型 ID" />
                        <button v-if="companionCanFetch" class="cp-fetch-btn" @click="fetchCompanionModels" :disabled="companionFetching" :title="companionFetchErr || '拉取模型列表'">
                          <WsIcon :name="companionFetching ? 'loading' : 'refresh'" size="xs" />
                        </button>
                      </div>
                    </div>
                    <div v-if="companionFetchErr" class="set-hint" style="color:var(--text-error)">{{ companionFetchErr }}</div>
                  </template>
                </template>
              </div>
            </template>
            <template v-if="cat.id === 'shortcuts'">
              <div v-show="match('快捷键 keyboard shortcut 键盘')" class="set-card">
                <div class="sc-head">快捷键</div>
                <div class="set-hint" style="margin-bottom:8px">点击快捷键开始记录，按下新的组合键即可修改</div>
                <div v-for="grp in shortcutGroups" :key="grp.scope" v-show="match('快捷键 ' + scopeLabel(grp.scope))" class="ss-group">
                  <h5 class="ss-scope">{{ scopeLabel(grp.scope) }}</h5>
                  <div v-for="s in grp.items" :key="s.id" v-show="match(s.description + ' ' + s.id)" class="ss-row">
                    <span class="ss-desc">{{ s.description }}</span>
                    <div class="ss-keys-area">
                      <span v-if="recording !== s.id" class="ss-keys" @click="startRecord(s.id)">
                        <kbd v-for="k in getDisplayKeys(s)" :key="k" class="ss-kbd">{{ fmt(k) }}</kbd>
                        <span class="ss-edit-icon"><WsIcon name="edit" size="xs" /></span>
                      </span>
                      <span v-else class="ss-recording" @click="cancelRecord">按下新的组合键...</span>
                      <button v-if="hasOverride(s.id)" class="ss-reset" @click.stop="resetKey(s.id)">↺</button>
                    </div>
                  </div>
                </div>
              </div>
            </template>

          </template>
          <div v-if="matchedCategories.length === 0" class="set-empty">未找到匹配的设置项</div>
        </template>

        <template v-else>
          <template v-if="activeSection === 'appearance'">
            <div class="set-card">
              <div class="sc-head">主题</div>
              <div class="set-theme-row">
                <button v-for="t in themes" :key="t.id" class="set-theme-btn" :class="{ on: currentThemeId === t.id }" @click="onThemeChange(t.id)">
                  <WsIcon :name="t.icon" size="md" class="st-icon" />
                  <span class="st-label">{{ t.label }}</span>
                </button>
              </div>
              <button class="set-theme-editor-btn" @click="openThemeEditor">
                <WsIcon name="theme-editor" size="xs" /> 主题编辑器
              </button>
            </div>
            <div class="set-card">
              <div class="sc-head">高亮</div>
              <div class="set-row"><span>脉冲动画</span><label class="set-toggle"><input type="checkbox" v-model="store.highlight_pulseEnabled" /><span class="set-toggle-slider"></span></label></div>
              <div class="set-row"><span>启用淡化</span><label class="set-toggle"><input type="checkbox" v-model="store.highlight_dimmingEnabled" /><span class="set-toggle-slider"></span></label></div>
              <template v-if="store.highlight_dimmingEnabled">
                <div class="set-row"><span>淡化模式</span><select v-model="store.highlight_dimmingMode" class="set-select"><option value="simple">简单淡化</option><option value="spread">关系扩散</option></select></div>
                <div class="set-row"><span>淡化透明度</span><div class="set-range-wrap"><input type="range" min="0.1" max="0.5" step="0.05" v-model.number="store.highlight_dimOpacity" class="set-range" /><span class="set-range-val">{{ store.highlight_dimOpacity }}</span></div></div>
                <div v-if="store.highlight_dimmingMode === 'spread'" class="set-row"><span>扩散跳数</span><select v-model.number="store.highlight_spreadHops" class="set-select"><option :value="1">1 跳</option><option :value="2">2 跳</option><option :value="3">3 跳</option></select></div>
              </template>
            </div>

            <div class="set-card">
              <div class="sc-head">字体库</div>
              <div class="sf-library-header">
                <label class="sf-import-btn">
                  导入字体
                  <input type="file" accept=".wsfont,.ttf,.otf,.woff,.woff2,.zip" @change="onFontImport" style="display:none" />
                </label>
                <span class="sf-storage-hint">{{ fontStorageHint }}</span>
              </div>
              <div v-if="fontLibraryEntries.length === 0" class="set-hint" style="padding:12px 0">尚未安装字体，点击"导入字体"添加</div>
              <div v-else class="sf-library-list">
                <!-- 无分组的独立字体 -->
                <div v-for="entry in standaloneEntries" :key="entry.id" class="sf-lib-card">
                  <div class="sf-lib-info">
                    <span class="sf-lib-name">{{ entry.displayName }}</span>
                    <span class="sf-lib-source" :data-source="entry.source">{{ sourceLabel(entry.source) }}</span>
                  </div>
                  <div class="sf-lib-preview" :style="{ fontFamily: `'${entry.family}', sans-serif` }">预览文本 Preview</div>
                  <div class="sf-lib-meta">{{ entry.variants.length }} 变体 · {{ formatSize(entry.totalSize) }}</div>
                  <button class="sf-lib-delete" @click="onFontDelete(entry.id)" title="删除字体">✕</button>
                </div>
                <!-- 按 ZIP 分组 -->
                <div v-for="group in fontGroups" :key="group.groupId" class="sf-lib-group">
                  <div class="sf-lib-group-header">
                    <WsIcon name="package" size="xs" />
                    <span class="sf-lib-group-name">{{ group.groupName }}</span>
                    <span class="sf-lib-group-count">{{ group.entries.length }} 字体</span>
                    <button class="sf-lib-group-delete" @click="onFontGroupDelete(group.groupId)" title="删除整组">✕</button>
                  </div>
                  <div v-for="entry in group.entries" :key="entry.id" class="sf-lib-card sf-lib-card--grouped">
                    <div class="sf-lib-info">
                      <span class="sf-lib-name">{{ entry.displayName }}</span>
                      <span class="sf-lib-source" :data-source="entry.source">{{ sourceLabel(entry.source) }}</span>
                    </div>
                    <div class="sf-lib-preview" :style="{ fontFamily: `'${entry.family}', sans-serif` }">预览文本 Preview</div>
                    <div class="sf-lib-meta">{{ entry.variants.length }} 变体 · {{ formatSize(entry.totalSize) }}</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="set-card">
              <div class="sc-head">字体分层</div>
              <div class="set-hint" style="margin-bottom:8px">每层字体可独立设置，未设置则跟随上层默认值</div>
              <div v-for="fl in FONT_LAYERS" :key="fl.key" class="sf-layer-row">
                <div class="sf-layer-main">
                  <span class="sf-layer-label">{{ fl.label }}<span class="set-hint-inline">{{ fl.hint }}</span></span>
                  <div class="sf-layer-controls">
                    <select class="set-select" :value="fontStore.prefs[fl.key].family" @change="onFontLayerChange(fl.key, ($event.target as HTMLSelectElement).value)">
                      <option value="">默认</option>
                      <option v-for="e in fontLibraryEntries" :key="e.id" :value="e.family">{{ e.displayName }}</option>
                    </select>
                    <button class="sf-reset-btn" v-if="fontStore.prefs[fl.key].family" @click="fontStore.resetLayer(fl.key)" title="重置为默认">↺</button>
                  </div>
                </div>
                <div v-if="fontStore.prefs[fl.key].family && getVariantsForFamily(fontStore.prefs[fl.key].family).length > 1" class="sf-layer-variants">
                  <select class="set-select set-select--sm" :value="variantKey(fontStore.prefs[fl.key])" @change="onVariantChange(fl.key, ($event.target as HTMLSelectElement).value)">
                    <option v-for="v in getVariantsForFamily(fontStore.prefs[fl.key].family)" :key="`${v.weight}-${v.style}`" :value="`${v.weight}-${v.style}`">{{ weightLabel(v.weight) }} {{ v.style === 'italic' ? '斜体' : '' }}</option>
                  </select>
                </div>
              </div>
            </div>
          </template>

          <template v-if="activeSection === 'plugins'">
            <div class="set-card">
              <div class="sc-head">插件管理</div>
              <div class="set-plugin-search"><input type="text" v-model="pluginSearch" placeholder="搜索插件..." class="set-input" /></div>
              <draggable v-if="!pluginSearch" :list="pluginList" item-key="id" ghost-class="sp-ghost" drag-class="sp-drag" handle=".sp-grip" @end="onPluginDragEnd" class="set-plugin-list">
                <template #item="{ element: p }">
                  <div class="set-plugin-item">
                    <span class="sp-grip" title="拖拽排序"><WsIcon name="grip" size="xs" /></span>
                    <span v-if="p.source" class="sp-source">{{ p.source === 'builtin' ? '内置' : p.source === 'local' ? '本地' : '远程' }}</span>
                    <label class="sp-toggle"><input type="checkbox" :checked="p.active" @change="onPluginToggle(p.id)" /><span class="sp-icon"><WsIcon v-if="hasIcon(p.icon)" :name="p.icon" size="sm" /><span v-else>{{ p.icon }}</span></span><span class="sp-label">{{ p.label }}</span></label>
                  </div>
                </template>
              </draggable>
              <div v-else class="set-plugin-list">
                <div v-for="p in filteredPlugins" :key="p.id" class="set-plugin-item">
                  <span v-if="p.source" class="sp-source">{{ p.source === 'builtin' ? '内置' : p.source === 'local' ? '本地' : '远程' }}</span>
                  <label class="sp-toggle"><input type="checkbox" :checked="p.active" @change="onPluginToggle(p.id)" /><span class="sp-icon"><WsIcon v-if="hasIcon(p.icon)" :name="p.icon" size="sm" /><span v-else>{{ p.icon }}</span></span><span class="sp-label">{{ p.label }}</span></label>
                </div>
              </div>
            </div>
          </template>

          <template v-if="activeSection === 'editor'">
            <div class="set-card">
              <div class="sc-head">撤销 / 重做</div>
              <div class="set-row"><span>撤销历史条数</span><input type="number" class="set-input set-input-sm" :value="store.undoHistoryLimit" min="5" max="100" @input="onUndoLimitChange" /></div>
              <div class="set-row"><span>多步重做</span><label class="set-toggle"><input type="checkbox" :checked="store.multiStepRedo" @change="store.multiStepRedo = ($event.target as HTMLInputElement).checked" /><span class="set-toggle-slider"></span></label></div>
              <div class="set-hint">关闭后 {{ formatKeyForDisplay('ctrl') }}+Y 仅重做一步</div>
            </div>
            <div class="set-card">
              <div class="sc-head">大纲</div>
              <div class="set-row"><span>内嵌编辑</span><label class="set-toggle"><input type="checkbox" v-model="store.outlineInlineEdit" /><span class="set-toggle-slider"></span></label></div>
              <div class="set-hint">启用后，大纲节点详情面板底部显示文本编辑区</div>
            </div>
            <div class="set-card">
              <div class="sc-head">光标</div>
              <div class="set-row"><span>平滑光标</span><label class="set-toggle"><input type="checkbox" v-model="store.smoothCaretEnabled" /><span class="set-toggle-slider"></span></label></div>
              <template v-if="store.smoothCaretEnabled">
                <div class="set-row"><span>动画时长 (ms)</span><input type="number" class="set-input set-input-sm" v-model.number="store.smoothCaretDuration" min="50" max="500" step="10" /></div>
                <div class="set-row"><span>光标样式</span><select v-model="store.smoothCaretVariant" class="set-select"><option value="line">竖线</option><option value="block">方块</option><option value="underline">下划线</option></select></div>
              </template>
            </div>
          </template>

          <template v-if="activeSection === 'layout'">
            <div class="set-card">
              <div class="sc-head">思维导图</div>
              <div class="set-row"><span>中心节点上限</span><input type="number" class="set-input set-input-sm" :value="store.maxCenterNodes" min="1" max="20" @input="onMaxCenterNodesChange" /></div>
            </div>
            <div class="set-card">
              <div class="sc-head">面板布局</div>
              <div class="set-row"><span>启用自定义视窗数量上限</span><label class="set-toggle"><input type="checkbox" :checked="store.panelLimitEnabled" @change="store.panelLimitEnabled = ($event.target as HTMLInputElement).checked" /><span class="set-toggle-slider"></span></label></div>
              <div class="set-row"><span>插件侧边栏位置</span>
                <div class="set-chip-group">
                  <label class="set-chip" :class="{ on: store.sidebarPosition === 'left' }">
                    <input type="radio" name="sidebarPosNormal" value="left" v-model="store.sidebarPosition" /> 左侧
                  </label>
                  <label class="set-chip" :class="{ on: store.sidebarPosition === 'right' }">
                    <input type="radio" name="sidebarPosNormal" value="right" v-model="store.sidebarPosition" /> 右侧
                  </label>
                </div>
              </div>
              <div class="set-row"><span>实体详情面板位置</span>
                <div class="set-chip-group">
                  <label class="set-chip" :class="{ on: store.detailPanelPosition === 'left' }">
                    <input type="radio" name="detailPosNormal" value="left" v-model="store.detailPanelPosition" /> 左侧
                  </label>
                  <label class="set-chip" :class="{ on: store.detailPanelPosition === 'right' }">
                    <input type="radio" name="detailPosNormal" value="right" v-model="store.detailPanelPosition" /> 右侧
                  </label>
                </div>
              </div>
              <div v-if="panelWidths.length > 0" class="set-panel-widths">
                <div v-for="pw in panelWidths" :key="pw.panelId" class="spw-row"><span class="spw-label">{{ panelLabel(pw.panelId) }}</span><span class="spw-value">{{ pw.width }}px</span><button class="spw-reset" @click="onResetPanelWidth(pw.panelId)">↺</button></div>
                <button class="set-btn" @click="resetAllWidths">重置所有面板宽度</button>
              </div>
            </div>
            <div class="set-card">
              <div class="sc-head">字段布局预设</div>
              <div class="set-hint">重置后恢复插件原始字段顺序，删除所有自定义字段和用户预设</div>
              <div class="set-btn-row">
                <button class="set-btn" @click="resetFieldPresets">重置所有字段预设</button>
                <button class="set-btn set-btn-danger" @click="resetCustomFields">清除所有自定义字段</button>
              </div>
            </div>
            <div class="set-card">
              <div class="sc-head">时间线</div>
              <div class="set-row"><span>拖拽改时间</span><label class="set-toggle"><input type="checkbox" v-model="store.timelineDragEnabled" /><span class="set-toggle-slider"></span></label></div>
              <div class="set-hint">启用后可在水平模式中拖拽事件条形修改日期</div>
              <div class="set-row"><span>默认布局模式</span><select v-model="store.timelineDefaultMode" class="set-select"><option value="vertical">垂直时间线</option><option value="horizontal">水平甘特图</option></select></div>
              <div class="set-row"><span>默认泳道分组</span><select v-model="store.timelineDefaultGroup" class="set-select"><option value="none">无分组</option><option value="character">按角色</option><option value="location">按地点</option><option value="era">按纪元</option><option value="tag">按标签</option></select></div>
              <div class="set-row"><span>紧凑模式</span><label class="set-toggle"><input type="checkbox" v-model="store.timelineCompactMode" /><span class="set-toggle-slider"></span></label></div>
              <div class="set-hint">垂直模式下使用紧凑卡片布局</div>
            </div>
          </template>

          <template v-if="activeSection === 'relations'">
            <div class="set-card">
              <div class="sc-head">关系</div>
              <div class="set-row"><span>自动创建实体提示</span><label class="set-toggle"><input type="checkbox" v-model="store.autoCreateEntityEnabled" /><span class="set-toggle-slider"></span></label></div>
              <template v-if="store.autoCreateEntityEnabled">
                <div class="set-row set-row-sub"><span>关系选择器中触发</span><label class="set-toggle"><input type="checkbox" v-model="store.autoCreateSelectorEnabled" /><span class="set-toggle-slider"></span></label></div>
                <div class="set-row set-row-sub"><span>实体引用字段中触发</span><label class="set-toggle"><input type="checkbox" v-model="store.autoCreateEntityRefEnabled" /><span class="set-toggle-slider"></span></label></div>
                <div class="set-row set-row-sub"><span>图谱视图中触发</span><label class="set-toggle"><input type="checkbox" v-model="store.autoCreateGraphEnabled" /><span class="set-toggle-slider"></span></label></div>
              </template>
            </div>
          </template>

          <template v-if="activeSection === 'video'">
            <div class="set-card">
              <div class="sc-head">陪伴模式</div>
              <div class="set-row"><span>启用陪伴模式</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeEnabled" /><span class="set-toggle-slider"></span></label></div>
              <div class="set-hint">编辑实体时，AI 以角色身份弹出通知评论</div>
              <div class="set-row"><span>Agent 空间内静默</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeSilentInSpace" /><span class="set-toggle-slider"></span></label></div>
              <div class="set-hint">在 Agent 空间中不触发陪伴模式通知</div>
            </div>
            <div class="set-card">
              <div class="sc-head">触发与弹窗</div>
              <div class="set-row"><span>弹窗持续时间（秒）</span><div class="set-range-wrap"><input type="range" min="3" max="15" step="1" v-model.number="store.companionModeDuration" class="set-range" /><span class="set-range-val">{{ store.companionModeDuration }}s</span></div></div>
              <div class="set-row"><span>防抖等待（秒）</span><div class="set-range-wrap"><input type="range" min="2" max="15" step="1" v-model.number="store.companionModeDebounce" class="set-range" /><span class="set-range-val">{{ store.companionModeDebounce }}s</span></div></div>
              <div class="set-row"><span>LLM 超时（秒）</span><div class="set-range-wrap"><input type="range" min="1" max="10" step="1" v-model.number="store.companionModeTimeout" class="set-range" /><span class="set-range-val">{{ store.companionModeTimeout }}s</span></div></div>
              <div class="set-row"><span>连续失败上限</span><div class="set-range-wrap"><input type="range" min="1" max="10" step="1" v-model.number="store.companionModeMaxFailures" class="set-range" /><span class="set-range-val">{{ store.companionModeMaxFailures }}次</span></div></div>
              <div class="set-row"><span>停顿触发阈值（秒）</span><div class="set-range-wrap"><input type="range" min="1" max="5" step="0.5" v-model.number="store.companionModePauseThreshold" class="set-range" /><span class="set-range-val">{{ store.companionModePauseThreshold }}s</span></div></div>
              <div class="set-row"><span>断句触发</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeSentenceTrigger" /><span class="set-toggle-slider"></span></label></div>
              <div class="set-row"><span>字数触发阈值</span><div class="set-range-wrap"><input type="range" min="5" max="50" step="5" v-model.number="store.companionModeCharThreshold" class="set-range" /><span class="set-range-val">{{ store.companionModeCharThreshold }}字</span></div></div>
            </div>
            <div class="set-card">
              <div class="sc-head">人格设置</div>
              <div class="set-row"><span>人格过渡动画</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModePersonaTransition" /><span class="set-toggle-slider"></span></label></div>
              <div class="set-row"><span>跨插件人格附体</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeCrossPlugin" /><span class="set-toggle-slider"></span></label></div>
              <div class="set-hint">编辑非生命体实体时，AI 可能以角色/种族/势力的人格说话</div>
              <div v-if="store.companionModeCrossPlugin" class="set-row set-row-sub"><span>人格切换概率</span><div class="set-range-wrap"><input type="range" min="0" max="100" step="5" v-model.number="store.companionModePersonaSwitchChance" class="set-range" /><span class="set-range-val">{{ store.companionModePersonaSwitchChance }}%</span></div></div>
            </div>
            <div class="set-card">
              <div class="sc-head">概率体系</div>
              <div class="set-row"><span>全局运气</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeLuckEnabled" /><span class="set-toggle-slider"></span></label></div>
              <div class="set-hint">启用后，AI 会经历"活跃期"和"沉默期"，表现更自然</div>
              <template v-if="store.companionModeLuckEnabled">
                <div class="set-row set-row-sub"><span>运气重置周期（分钟）</span><div class="set-range-wrap"><input type="range" min="3" max="15" step="1" v-model.number="store.companionModeLuckResetMinutes" class="set-range" /><span class="set-range-val">{{ store.companionModeLuckResetMinutes }}分</span></div></div>
                <div class="set-row set-row-sub"><span>运气重置操作数</span><div class="set-range-wrap"><input type="range" min="5" max="30" step="1" v-model.number="store.companionModeLuckResetOps" class="set-range" /><span class="set-range-val">{{ store.companionModeLuckResetOps }}次</span></div></div>
              </template>
            </div>
            <div class="set-card">
              <div class="sc-head">场景概率</div>
              <div class="set-hint" style="margin-bottom:8px">每种操作场景的独立触发概率</div>
              <div v-for="sp in sceneProbItems" :key="sp.id" class="set-row">
                <span>{{ sp.label }}</span>
                <div class="set-range-wrap"><input type="range" min="0" max="100" step="5" :value="store.companionModeSceneProbs[sp.id] ?? sp.defaultVal" @input="onSceneProbChange(sp.id, $event)" class="set-range" /><span class="set-range-val">{{ store.companionModeSceneProbs[sp.id] ?? sp.defaultVal }}%</span></div>
              </div>
            </div>
            <div class="set-card">
              <div class="sc-head">弹窗交互</div>
              <div class="set-row"><span>弹窗位置场景化</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModePositionContext" /><span class="set-toggle-slider"></span></label></div>
              <div class="set-hint">根据操作场景自动调整弹窗出现位置</div>
              <div class="set-row"><span>点击停驻</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeClickPin" /><span class="set-toggle-slider"></span></label></div>
              <div class="set-hint">点击弹窗可停驻并查看历史消息</div>
            </div>
            <div class="set-card">
              <div class="sc-head">模型配置</div>
              <div class="set-row"><span>使用独立模型</span><label class="set-toggle"><input type="checkbox" v-model="store.companionModeCustomModel" /><span class="set-toggle-slider"></span></label></div>
              <div class="set-hint">关闭时跟随主模型配置；开启后从已配置的供应商中选择</div>
              <template v-if="store.companionModeCustomModel">
                <div class="set-row set-row-sub"><span>供应商</span>
                  <select v-model="store.companionModeProviderKey" class="set-select">
                    <option value="" disabled>选择供应商</option>
                    <option v-for="p in companionProviderList" :key="p.key" :value="p.key">{{ p.label }}</option>
                  </select>
                </div>
                <template v-if="store.companionModeProviderKey">
                  <div class="set-row set-row-sub"><span>模型</span>
                    <div class="cp-model-field">
                      <select v-if="companionCurrentModels.length > 0" v-model="store.companionModeModelId" class="set-select">
                        <option value="" disabled>选择模型</option>
                        <option v-for="m in companionCurrentModels" :key="m.id" :value="m.id">{{ m.name }}</option>
                      </select>
                      <input v-else type="text" v-model="store.companionModeModelId" class="set-input" placeholder="输入模型 ID" />
                      <button v-if="companionCanFetch" class="cp-fetch-btn" @click="fetchCompanionModels" :disabled="companionFetching" :title="companionFetchErr || '拉取模型列表'">
                        <WsIcon :name="companionFetching ? 'loading' : 'refresh'" size="xs" />
                      </button>
                    </div>
                  </div>
                  <div v-if="companionFetchErr" class="set-hint" style="color:var(--text-error)">{{ companionFetchErr }}</div>
                </template>
              </template>
            </div>
          </template>

          <template v-if="activeSection === 'shortcuts'">
            <div class="set-card">
              <div class="sc-head">快捷键</div>
              <div class="set-hint" style="margin-bottom:8px">点击快捷键开始记录，按下新的组合键即可修改</div>
              <div v-for="grp in shortcutGroups" :key="grp.scope" class="ss-group">
                <h5 class="ss-scope">{{ scopeLabel(grp.scope) }}</h5>
                <div v-for="s in grp.items" :key="s.id" class="ss-row">
                  <span class="ss-desc">{{ s.description }}</span>
                  <div class="ss-keys-area">
                    <span v-if="recording !== s.id" class="ss-keys" @click="startRecord(s.id)">
                      <kbd v-for="k in getDisplayKeys(s)" :key="k" class="ss-kbd">{{ fmt(k) }}</kbd>
                      <span class="ss-edit-icon"><WsIcon name="edit" size="xs" /></span>
                    </span>
                    <span v-else class="ss-recording" @click="cancelRecord">按下新的组合键...</span>
                    <button v-if="hasOverride(s.id)" class="ss-reset" @click.stop="resetKey(s.id)">↺</button>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <template v-if="activeSection === 'storage'">
            <StorageManagementTab />
          </template>


        </template>
      </div>

      <div class="resize-handle-right" v-if="false" @mousedown="modalResizable.onResizeStart"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useSettingsStore } from '../../stores/settingsStore'
import { getModelsByProvider, getDefaultModelId, MODEL_REGISTRY } from '../../agent/modelRegistry'
import { useUIStore } from '../../stores/uiStore'
import { useTheme } from '../../composables/useTheme'
import { usePluginStore } from '@worldsmith/entity-core'
import { useShortcuts, formatKeyForDisplay, useConfirm, useResizable, getAllPanelWidths, resetPanelWidth, resetAllPanelWidths, PANEL_LABELS } from '@worldsmith/ui-kit'
import WsIcon from '../WsIcon.vue'
import { hasIcon } from '../../assets/iconRegistry'
import { useFieldOrderStore, fieldRegistry } from '@worldsmith/entity-core'
import { toastSuccess } from '../../composables/useToast'
import draggable from 'vuedraggable'
// 创作编排面板已移除旧的编辑器偏好设置
import StorageManagementTab from '../data/StorageManagementTab.vue'
import { useFontStore, type FontLayer } from '../../stores/fontStore'
import { useFontPresets } from '../../composables/useFontPresets'
import type { FontLibraryEntry, FontVariantEntry } from '../../composables/fontInstaller'
import { useFontLibraryStore } from '../../stores/fontLibraryStore'
import { getProviderLabelMap } from '@agent/providers/provider-registry'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const modalResizable = useResizable({ panelId: 'modal-settings', defaultWidth: 560, minWidth: 400, side: 'right' })

const panelWidths = ref<{ panelId: string; width: number }[]>([])

function refreshPanelWidths() {
  panelWidths.value = getAllPanelWidths()
}

watch(() => props.show, (val) => {
  if (val) {
    dirty.value = false
    activeSection.value = null
    refreshPanelWidths()
  }
})

function panelLabel(panelId: string): string {
  return PANEL_LABELS[panelId] || panelId
}

function onResetPanelWidth(id: string) {
  resetPanelWidth(id)
  refreshPanelWidths()
  toastSuccess('已恢复默认宽度')
}

function resetAllWidths() {
  resetAllPanelWidths()
  refreshPanelWidths()
  toastSuccess('已重置所有面板宽度')
}

const store = useSettingsStore()
const uiStore = useUIStore()
const { currentThemeId, setTheme: setThemeFromEngine } = useTheme()
const pluginStore = usePluginStore()
const fieldOrderStore = useFieldOrderStore()
const fontStore = useFontStore()
const { getPresetByFamily, markInstalled } = useFontPresets()
const libraryStore = useFontLibraryStore()
const fontLibraryEntries = computed(() => libraryStore.getAllEntries())

const standaloneEntries = computed(() =>
  fontLibraryEntries.value.filter(e => !e.groupId),
)

interface FontGroup {
  groupId: string
  groupName: string
  entries: FontLibraryEntry[]
}

const fontGroups = computed<FontGroup[]>(() => {
  const map = new Map<string, FontGroup>()
  for (const e of fontLibraryEntries.value) {
    if (!e.groupId || !e.groupName) continue
    let group = map.get(e.groupId)
    if (!group) {
      group = { groupId: e.groupId, groupName: e.groupName, entries: [] }
      map.set(e.groupId, group)
    }
    group.entries.push(e)
  }
  return Array.from(map.values())
})

const fontStorageHint = computed(() => {
  const used = libraryStore.totalSize
  return `${(used / 1024 / 1024).toFixed(1)} MB / 400 MB`
})

function sourceLabel(source: string): string {
  const map: Record<string, string> = { preset: '预设', wsfont: 'wsfont', raw: 'ttf/otf', windfonts: 'WindFonts', system: '系统', zip: 'ZIP' }
  return map[source] || source
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function onFontDelete(id: string) {
  const result = await libraryStore.removeEntry(id)
  if (result.ok && result.affectedLayers.length > 0) {
    toastSuccess(`已删除字体，${result.affectedLayers.join('、')}层已重置为默认`)
  } else if (result.ok) {
    toastSuccess('已删除字体')
  }
}

async function onFontGroupDelete(groupId: string) {
  const groupEntries = fontLibraryEntries.value.filter(e => e.groupId === groupId)
  if (groupEntries.length === 0) return
  const allAffectedLayers: string[] = []
  for (const entry of groupEntries) {
    const result = await libraryStore.removeEntry(entry.id)
    if (result.ok && result.affectedLayers.length > 0) {
      allAffectedLayers.push(...result.affectedLayers)
    }
  }
  const layerInfo = allAffectedLayers.length > 0 ? `，${[...new Set(allAffectedLayers)].join('、')}层已重置` : ''
  toastSuccess(`已删除整组字体（${groupEntries.length} 个）${layerInfo}`)
}
const { confirm } = useConfirm()

const { updateKeys } = useShortcuts()

const dirty = ref(false)

// ── 字体分层配置 ──
const FONT_LAYERS: { key: FontLayer; label: string; hint: string }[] = [
  { key: 'chrome', label: '界面字体', hint: 'Shell、侧栏、菜单、对话框、按钮' },
  { key: 'editorUi', label: '编辑器 UI', hint: '编辑器工具栏、章节列表、插件工具栏' },
  { key: 'content', label: '内容字体', hint: '正文编辑区、Notebook Markdown' },
  { key: 'preview', label: '预览字体', hint: '手机预览、DOCX 导出' },
  { key: 'canvas', label: '画布字体', hint: 'FontRenderer 图片渲染' },
  { key: 'agent', label: 'Agent', hint: '对话输出' },
]

function onFontLayerChange(layer: FontLayer, family: string) {
  fontStore.setLayerFont(layer, family)
  if (family) {
    const preset = getPresetByFamily(family)
    if (preset) markInstalled(preset.id)
  }
}

function getVariantsForFamily(family: string): FontVariantEntry[] {
  const entry = fontLibraryEntries.value.find(e => e.family === family)
  return entry?.variants ?? []
}

function variantKey(pref: { weight: number; style: string }): string {
  return `${pref.weight}-${pref.style}`
}

const WEIGHT_LABELS: Record<number, string> = {
  100: '极细', 200: '超细', 300: '细体', 400: '常规',
  500: '中等', 600: '半粗', 700: '粗体', 800: '超粗', 900: '极粗',
}

function weightLabel(w: number): string {
  return WEIGHT_LABELS[w] ?? `${w}`
}

function onVariantChange(layer: FontLayer, key: string) {
  const [w, s] = key.split('-')
  fontStore.setLayerVariant(layer, Number(w), s)
}

function onFontImport(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (file.size > 200 * 1024 * 1024) {
    toastSuccess(`文件过大 (${(file.size / 1024 / 1024).toFixed(1)} MB)，上限 200 MB`)
    input.value = ''
    return
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''

  import("../../composables/fontInstaller").then(async ({ installFromWsfont, installFromRawFont, installFromZip }) => {
    const buffer = await file.arrayBuffer()

    if (ext === 'zip') {
      const { entries } = await installFromZip(buffer, file.name)
      let installed = 0
      for (const entry of entries) {
        const result = libraryStore.addEntry(entry)
        if (result.ok) installed++
      }
      toastSuccess(`已从 ZIP 安装 ${installed} 个字体`)
    } else {
      let entry: FontLibraryEntry | undefined

      if (ext === 'wsfont') {
        const result = await installFromWsfont(buffer)
        entry = result.entry
      } else if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) {
        const result = await installFromRawFont(buffer, file.name)
        entry = result.entry
      }

      if (entry) {
        const result = libraryStore.addEntry(entry)
        if (result.ok) {
          toastSuccess(`已安装字体: ${entry.displayName}`)
        } else {
          toastSuccess(result.reason || '安装失败')
        }
      } else {
        toastSuccess('不支持的字体格式')
      }
    }
  }).catch((err) => {
    const msg = err instanceof Error ? err.message : '字体安装失败，请确认文件格式正确'
    toastSuccess(msg)
  })
  input.value = ''
}

// ── 陪伴模式模型列表 ──
const CLOUD_PROVIDER_LABELS: Record<string, string> = getProviderLabelMap()

interface CompanionProviderEntry {
  key: string
  label: string
  type: 'cloud' | 'local' | 'custom'
}

const companionProviderList = computed<CompanionProviderEntry[]>(() => {
  const list: CompanionProviderEntry[] = []
  // 云端供应商：从 modelRegistry 中已有模型的供应商自动列出
  const allProviders = new Set<string>()
  for (const m of MODEL_REGISTRY) allProviders.add(m.provider)
  for (const provider of allProviders) {
    const label = CLOUD_PROVIDER_LABELS[provider] || provider
    list.push({ key: `cloud:${provider}`, label: `${label}（云端）`, type: 'cloud' })
  }
  // 本地模型：如果主配置中本地端点有模型
  if (store.aiLocalModel) {
    list.push({ key: 'local:default', label: `${store.aiLocalType.toUpperCase()}（本地）`, type: 'local' })
  }
  // 自定义供应商
  for (const cp of store.customProviders) {
    list.push({ key: `custom:${cp.id}`, label: `${cp.name || cp.baseUrl}（自定义）`, type: 'custom' })
  }
  return list
})

const companionProviderType = computed<'cloud' | 'local' | 'custom' | ''>(() => {
  const key = store.companionModeProviderKey
  if (!key) return ''
  const [mode] = key.split(':')
  return mode as 'cloud' | 'local' | 'custom'
})

// 云端：直接从 modelRegistry 获取模型列表
const companionCloudModelsFromRegistry = computed(() => {
  if (companionProviderType.value !== 'cloud') return []
  const provider = store.companionModeProviderKey.split(':').slice(1).join(':')
  return getModelsByProvider(provider)
})

// 本地/自定义：拉取的模型列表
const companionFetchedModels = ref<{ id: string; name: string }[]>([])
const companionFetching = ref(false)
const companionFetchErr = ref('')

const companionCanFetch = computed(() => {
  const type = companionProviderType.value
  if (type === 'local') return !!store.aiLocalEndpoint
  if (type === 'custom') {
    const cpId = store.companionModeProviderKey.split(':').slice(1).join(':')
    const cp = store.customProviders.find(p => p.id === cpId)
    return !!cp?.baseUrl
  }
  return false
})

const companionCurrentModels = computed(() => {
  if (companionProviderType.value === 'cloud') {
    return companionCloudModelsFromRegistry.value
  }
  return companionFetchedModels.value
})

async function fetchCompanionModels() {
  const type = companionProviderType.value
  if (type === 'cloud') return // 云端不需要拉取，直接从 registry 获取

  companionFetching.value = true
  companionFetchErr.value = ''
  companionFetchedModels.value = []

  try {
    if (type === 'local') {
      const endpoint = store.aiLocalEndpoint.replace(/\/+$/, '')
      const url = endpoint.includes('/api/') ? `${endpoint}/tags` : `${endpoint}/api/tags`
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) { companionFetchErr.value = `拉取失败: HTTP ${res.status}`; return }
      const data = await res.json()
      const models: { id: string; name: string }[] = (data.models || [])
        .map((m: any) => ({ id: m.name || m.model, name: m.name || m.model }))
        .filter((m: any) => typeof m.id === 'string')
        .sort((a: any, b: any) => a.id.localeCompare(b.id))
      if (models.length === 0) { companionFetchErr.value = '未发现可用模型'; return }
      companionFetchedModels.value = models
    } else if (type === 'custom') {
      const cpId = store.companionModeProviderKey.split(':').slice(1).join(':')
      const cp = store.customProviders.find(p => p.id === cpId)
      if (!cp) { companionFetchErr.value = '供应商未找到'; return }
      const baseUrl = cp.baseUrl.replace(/\/+$/, '')
      const isRemote = /^https?:\/\//.test(baseUrl)
      let modelsUrl: string
      const headers: Record<string, string> = {}
      if (isRemote) {
        try {
          const url = new URL(baseUrl)
          headers['X-Target-Base-Url'] = `${url.protocol}//${url.host}`
          let basePath = url.pathname.replace(/\/+$/, '')
          if (!basePath) basePath = '/v1'
          modelsUrl = `/api/custom-proxy${basePath}/models`
        } catch { companionFetchErr.value = '无效的 Base URL'; return }
      } else {
        modelsUrl = baseUrl.includes('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`
      }
      const res = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(15000) })
      if (!res.ok) { companionFetchErr.value = `拉取失败: HTTP ${res.status}`; return }
      const data = await res.json()
      const models: { id: string; name: string }[] = (data.data || [])
        .map((m: any) => ({ id: m.id, name: m.id }))
        .filter((m: any) => typeof m.id === 'string')
        .sort((a: any, b: any) => a.id.localeCompare(b.id))
      if (models.length === 0) { companionFetchErr.value = '未发现可用模型'; return }
      companionFetchedModels.value = models
    }
  } catch (e: any) {
    companionFetchErr.value = e.name === 'TimeoutError' ? '拉取超时' : `拉取失败: ${e.message || e}`
  } finally {
    companionFetching.value = false
  }
}

// 切换供应商时重置模型列表和已拉取数据
watch(() => store.companionModeProviderKey, () => {
  companionFetchedModels.value = []
  companionFetchErr.value = ''
  // 云端自动设置默认模型
  if (companionProviderType.value === 'cloud') {
    const provider = store.companionModeProviderKey.split(':').slice(1).join(':')
    const defaultId = getDefaultModelId(provider)
    if (defaultId) store.companionModeModelId = defaultId
  } else {
    store.companionModeModelId = ''
  }
})

const themes = [
  { id: 'aurora-abyss', icon: 'theme-aurora-abyss', label: '极光深渊' },
  { id: 'light', icon: 'theme-light', label: '明亮' },
  { id: 'forge-ember', icon: 'theme-forge-ember', label: '锻造炉' },
  { id: 'ink-scroll', icon: 'theme-ink-scroll', label: '水墨卷轴' },
  { id: 'crystal-prism', icon: 'theme-crystal-prism', label: '晶体棱镜' },
  { id: 'cosmic', icon: 'theme-cosmic', label: '宇宙' },
]

const categories = [
  { id: 'appearance', icon: 'cat-appearance', label: '外观' },
  { id: 'plugins', icon: 'cat-plugins', label: '插件' },
  { id: 'editor', icon: 'cat-editor', label: '编辑' },
  { id: 'layout', icon: 'cat-layout', label: '布局' },
  { id: 'relations', icon: 'cat-relations', label: '关系' },
  { id: 'video', icon: 'cat-video', label: '陪伴模式' },
  { id: 'shortcuts', icon: 'cat-shortcuts', label: '快捷键' },
  { id: 'storage', icon: 'cat-storage', label: '存储' },
]

const activeSection = ref<string | null>(null)
const searchQuery = ref('')
const pluginSearch = ref('')

const CATEGORY_KEYWORDS: Record<string, string> = {
  appearance: '主题 外观 深色 浅色 宇宙 极光 锻造 水墨 棱镜 编辑器 高亮 脉冲 动画 淡化 扩散 透明度 theme highlight',
  plugins: '插件 扩展 模块 启用 禁用 内置 本地 远程 plugin',
  editor: '编辑 撤销 重做 历史 大纲 内嵌 光标 平滑 undo redo outline caret smooth',
  fonts: '字体 预设 内容 界面 书法 宋体 楷体 无衬线 font preset content chrome editor',
  layout: '布局 面板 思维导图 中心节点 字段 预设 宽度 panel mindmap field 时间线 timeline 拖拽 泳道 甘特图 紧凑 分组',
  relations: '关系 自动 创建 实体 引用 图谱 选择器 relation auto create',
  video: '陪伴模式 video 通知 弹窗 人格 角色 附体 persona 概率 运气 场景 停驻 断句 字数 模型 独立 供应商 空间 静默',
  shortcuts: '快捷键 键盘 快捷 绑定 shortcut keyboard',
  storage: '存储 清理 孤立 文件 诊断 缓存 空间 配额 storage cleanup orphan diagnostic',
}

const matchedCategories = computed(() => {
  if (!searchQuery.value) return []
  const q = searchQuery.value.toLowerCase()
  return categories.filter(cat => CATEGORY_KEYWORDS[cat.id]?.toLowerCase().includes(q))
})

function match(keywords: string): boolean {
  if (!searchQuery.value) return true
  const q = searchQuery.value.toLowerCase()
  return keywords.toLowerCase().includes(q)
}

const pluginList = ref(store.plugins.map(p => ({ ...p })))

function syncPluginList() {
  const order = uiStore.sidebarOrder
  const sorted = [...store.plugins].sort((a, b) => {
    const va = pluginStore.views.find(v => v.pluginId === a.id)
    const vb = pluginStore.views.find(v => v.pluginId === b.id)
    const ia = va ? order.indexOf(va.id) : 999
    const ib = vb ? order.indexOf(vb.id) : 999
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })
  pluginList.value = sorted.map(p => ({ ...p }))
}

watch(() => [uiStore.sidebarOrder, store.plugins] as const, () => {
  syncPluginList()
}, { deep: true, immediate: true })

const filteredPlugins = computed(() => {
  if (!pluginSearch.value) return pluginList.value
  const q = pluginSearch.value.toLowerCase()
  return pluginList.value.filter(p =>
    p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
  )
})

function onPluginDragEnd() {
  const newOrder = pluginList.value
    .map(p => pluginStore.views.find(v => v.pluginId === p.id)?.id)
    .filter((id): id is string => !!id)
  const existing = new Set(newOrder)
  for (const id of uiStore.sidebarOrder) {
    if (!existing.has(id)) newOrder.push(id)
  }
  uiStore.sidebarOrder = newOrder
  dirty.value = true
}

function onTabClick(id: string) {
  activeSection.value = activeSection.value === id ? null : id
  searchQuery.value = ''
  pluginSearch.value = ''
}

function onThemeChange(id: string) {
  setThemeFromEngine(id)
  dirty.value = true
}

function openThemeEditor() {
  window.dispatchEvent(new CustomEvent('ws-open-theme-editor'))
}

function onPluginToggle(id: string) {
  store.togglePlugin(id)
  dirty.value = true
}

function onUndoLimitChange(e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  if (val >= 5 && val <= 100) {
    store.undoHistoryLimit = val
    dirty.value = true
  }
}

function onMaxCenterNodesChange(e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  if (val >= 1 && val <= 20) {
    store.maxCenterNodes = val
    dirty.value = true
  }
}

async function resetFieldPresets() {
  const ok = await confirm({ type: 'danger', title: '重置字段布局预设', description: '确定要重置所有字段布局预设吗？这将恢复插件原始字段顺序，删除所有用户预设。' })
  if (!ok) return
  fieldOrderStore.resetAll()
  fieldRegistry.resetToBuiltin()
  toastSuccess('已重置所有字段预设')
}

async function resetCustomFields() {
  const ok = await confirm({ type: 'danger', title: '清除自定义字段', description: '确定要清除所有自定义字段吗？此操作不可撤销！' })
  if (!ok) return
  fieldRegistry.resetToBuiltin()
  toastSuccess('已清除所有自定义字段')
}

function close() {
  if (dirty.value) {
    const currentView = uiStore.currentView
    if (currentView) {
      const view = pluginStore.getView(currentView)
      if (view?.pluginId && !store.isActive(view.pluginId)) {
        const firstActive = pluginStore.views.find(v => !v.pluginId || store.isActive(v.pluginId))
        if (firstActive) {
          uiStore.setView(firstActive.id)
          uiStore.viewComponent = firstActive.component
        }
      }
    }
    uiStore.viewRefreshKey++
  }
  dirty.value = false
  searchQuery.value = ''
  pluginSearch.value = ''
  emit('close')
}

interface ShortcutItem {
  id: string; description: string; keys: string[]; scope: string
}

const DEFAULT_SHORTCUTS: ShortcutItem[] = [
  { id: 'help.shortcuts', description: '打开快捷键帮助', keys: ['?'], scope: 'global' },
  { id: 'sidebar.toggle', description: '切换侧边栏', keys: ['ctrl', 'b'], scope: 'global' },
  { id: 'search.open', description: '全局搜索', keys: ['ctrl', 'k'], scope: 'global' },
  { id: 'menu.import-export', description: '导入/导出', keys: ['ctrl', 'shift', 's'], scope: 'global' },
  { id: 'settings.open', description: '打开设置', keys: ['ctrl', ','], scope: 'global' },
  { id: 'undo', description: '撤销', keys: ['ctrl', 'z'], scope: 'global' },
  { id: 'redo', description: '重做', keys: ['ctrl', 'shift', 'z'], scope: 'global' },
  { id: 'redo-alt', description: '重做（替代）', keys: ['ctrl', 'y'], scope: 'global' },
  { id: 'global.undo', description: '撤销', keys: ['ctrl', 'z'], scope: 'global' },
  { id: 'global.redo', description: '重做', keys: ['ctrl', 'y'], scope: 'global' },
  { id: 'global.undoHistory', description: '撤销历史面板', keys: ['ctrl', 'shift', 'z'], scope: 'global' },
  { id: 'entity.save', description: '保存实体', keys: ['ctrl', 's'], scope: 'view' },
  { id: 'entity.delete', description: '删除实体', keys: ['delete'], scope: 'view' },
  { id: 'panel.close', description: '关闭详情面板', keys: ['escape'], scope: 'view' },
  { id: 'dialog.confirm', description: '确认弹窗', keys: ['enter'], scope: 'modal' },
  { id: 'dialog.cancel', description: '取消弹窗', keys: ['escape'], scope: 'modal' },
  { id: 'region.borderline', description: '区域图谱：边境线模式', keys: ['alt'], scope: 'view' },
  { id: 'drawing.undo', description: '画板：撤销', keys: ['ctrl', 'z'], scope: 'view' },
  { id: 'drawing.redo', description: '画板：重做', keys: ['ctrl', 'shift', 'z'], scope: 'view' },
  { id: 'drawing.zoomIn', description: '画板：放大', keys: ['ctrl', '='], scope: 'view' },
  { id: 'drawing.zoomOut', description: '画板：缩小', keys: ['ctrl', '-'], scope: 'view' },
  { id: 'drawing.fitView', description: '画板：适应视图', keys: ['ctrl', '0'], scope: 'view' },
  { id: 'mindmap.newCharacter', description: '思维导图：新建角色', keys: ['n', 'c'], scope: 'view' },
  { id: 'mindmap.newRegion', description: '思维导图：新建区域', keys: ['n', 'r'], scope: 'view' },
  { id: 'mindmap.newEvent', description: '思维导图：新建事件', keys: ['n', 'e'], scope: 'view' },
  { id: 'mindmap.newTextbox', description: '思维导图：新建文本框', keys: ['n', 't'], scope: 'view' },
  { id: 'mindmap.editName', description: '思维导图：编辑名称', keys: ['e', 'n'], scope: 'view' },
  { id: 'mindmap.editDesc', description: '思维导图：编辑描述', keys: ['e', 'd'], scope: 'view' },
  { id: 'mindmap.connect', description: '思维导图：连接节点', keys: ['c', 'l'], scope: 'view' },
  { id: 'mindmap.deleteNode', description: '思维导图：删除节点', keys: ['d', 'n'], scope: 'view' },
  { id: 'mindmap.createSection', description: '思维导图：创建分组框', keys: ['g', 's'], scope: 'view' },
  { id: 'mindmap.focusNode', description: '思维导图：聚焦节点', keys: ['f', 'n'], scope: 'view' },
  { id: 'mindmap.jumpInto', description: '思维导图：进入子图', keys: ['j', 'i'], scope: 'view' },
  { id: 'mindmap.toggleDetail', description: '思维导图：切换详情侧栏', keys: ['i'], scope: 'view' },
  { id: 'mindmap.fitView', description: '思维导图：适应视图', keys: ['f'], scope: 'view' },
  { id: 'mindmap.exitNested', description: '思维导图：返回上层', keys: ['escape'], scope: 'view' },
]

const recording = ref<string | null>(null)

const sceneProbItems = [
  { id: 'entity_create', label: '实体创建', defaultVal: 80 },
  { id: 'entity_delete', label: '实体删除', defaultVal: 90 },
  { id: 'field_short', label: '短文本编辑', defaultVal: 50 },
  { id: 'field_long', label: '长文本编辑', defaultVal: 40 },
  { id: 'name_input', label: '名称输入', defaultVal: 60 },
  { id: 'relation_create', label: '关系创建', defaultVal: 30 },
  { id: 'relation_delete', label: '关系删除', defaultVal: 40 },
  { id: 'view_switch', label: '视图切换', defaultVal: 20 },
  { id: 'batch_edit', label: '批量编辑', defaultVal: 25 },
]

function onSceneProbChange(sceneId: string, event: Event) {
  const val = Number((event.target as HTMLInputElement).value)
  store.companionModeSceneProbs = { ...store.companionModeSceneProbs, [sceneId]: val }
  dirty.value = true
}

const SCOPE_ORDER = ['global', 'view', 'editor', 'modal']

const allShortcuts = computed(() => DEFAULT_SHORTCUTS)

const shortcutGroups = computed(() => {
  return SCOPE_ORDER
    .map(scope => ({
      scope,
      items: allShortcuts.value.filter(s => s.scope === scope),
    }))
    .filter(g => g.items.length > 0)
})

function scopeLabel(scope: string): string {
  const m: Record<string, string> = { global: '全局', view: '当前视图', editor: '编辑器', modal: '弹窗' }
  return m[scope] || scope
}

function fmt(k: string): string {
  return formatKeyForDisplay(k)
}

function getDisplayKeys(s: ShortcutItem): string[] {
  return store.getShortcut(s.id)
}

function hasOverride(id: string): boolean {
  return id in store.shortcutOverrides
}

function startRecord(id: string) {
  recording.value = id
}

function cancelRecord() {
  recording.value = null
}

function resetKey(id: string) {
  store.resetShortcut(id)
  const defaults = store.SHORTCUT_DEFAULTS as Record<string, string[]>
  if (defaults[id]) {
    updateKeys(id, defaults[id])
  }
  dirty.value = true
}

function onRecordKeydown(e: KeyboardEvent) {
  if (!recording.value) return
  e.preventDefault()
  e.stopPropagation()

  const keys: string[] = []
  if (e.ctrlKey || e.metaKey) keys.push('ctrl')
  if (e.altKey) keys.push('alt')
  if (e.shiftKey) keys.push('shift')

  const main = e.key.toLowerCase()
  if (!['control', 'meta', 'alt', 'shift'].includes(main)) {
    const special: Record<string, string> = {
      'escape': 'escape', 'enter': 'enter', ' ': 'space',
      'delete': 'delete', 'backspace': 'backspace', 'tab': 'tab',
    }
    keys.push(special[main] || main)
  }

  if (keys.length > 0) {
    store.setShortcut(recording.value, keys)
    updateKeys(recording.value, keys)
    dirty.value = true
    recording.value = null
  }
}

onMounted(() => {
  document.addEventListener('keydown', onRecordKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onRecordKeydown)
})
</script>

<style scoped>
.set-overlay { position: fixed; inset: 0; z-index: var(--z-overlay); background: rgba(0,0,0,0.35); display: flex; align-items: flex-start; justify-content: center; padding-top: 3vh; }
.set-shell { max-height: 78vh; display: flex; flex-direction: column; position: relative; min-width: 420px; max-width: 680px; width: auto; }

.set-topbar { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--content-bg, var(--color-bg-surface)); border-radius: 10px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
.set-topbar-left { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); flex-shrink: 0; }
.set-topbar-title { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--text-color); }
.set-topbar-spacer { flex: 1; }
.set-search-wrap { position: relative; width: 500px; flex-shrink: 0; }
.set-search-icon { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary, var(--color-text-tertiary)); pointer-events: none; }
.set-search-input { width: 100%; height: 28px; padding: 5px 28px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border)); border-radius: 6px; background: var(--bg, var(--color-bg-surface)); color: #C8E6F0; }
.set-search-input:focus { outline: none; border-color: var(--primary, var(--color-primary)); }
.set-search-input::placeholder { color: var(--text-tertiary, var(--color-text-tertiary)); }
.set-search-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: none; border: none; font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); cursor: pointer; padding: 2px; }
.set-search-clear:hover { color: var(--text-color); }
.set-close { background: none; border: none; font-size: var(--font-size-lg); cursor: pointer; padding: 4px 6px; border-radius: 4px; color: var(--text-tertiary, var(--color-text-tertiary)); flex-shrink: 0; }
.set-close:hover { background: var(--hover-bg, var(--color-bg-hover)); color: var(--text-color); }

.set-tabs { display: flex; gap: 6px; padding: 8px 0 0; flex-wrap: wrap; }
.set-tab { display: flex; align-items: center; gap: 5px; padding: 7px 14px; border: none; border-radius: 8px; background: var(--content-bg, var(--color-bg-surface)); color: var(--text-secondary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap; box-shadow: 0 1px 4px rgba(0,0,0,0.05), 0 0 0 1px var(--border, var(--color-border)); }
.set-tab:hover { background: var(--content-bg, var(--color-bg-surface)); color: var(--text-color); box-shadow: 0 2px 8px rgba(0,0,0,0.08), 0 0 0 1px var(--border, var(--color-border)); }
.set-tab.active { background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); color: var(--primary, var(--color-primary)); font-weight: var(--font-weight-medium); box-shadow: 0 2px 8px color-mix(in srgb, var(--color-primary) 12%, transparent), 0 0 0 1px var(--primary, color-mix(in srgb, var(--color-primary) 20%, transparent)); }
.stb-icon { display: inline-flex; }
.stb-label { }

.set-cards { margin-top: 12px; padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }

.set-card { background: var(--content-bg, var(--color-bg-surface)); border-radius: 10px; padding: 14px 16px; box-shadow: 0 1px 6px rgba(0,0,0,0.06), 0 0 0 1px var(--border, var(--color-border)); }
.sc-head { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-tertiary, var(--color-text-tertiary)); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }

.set-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: var(--font-size-sm); gap: 12px; }
.set-row-sub { padding-left: 16px; }
.set-hint { font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); margin: -2px 0 4px; }

.set-theme-row { display: flex; gap: 6px; }
.set-theme-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 4px; border: 1px solid var(--border, var(--color-border)); border-radius: 8px; background: var(--bg, var(--color-bg-surface)); cursor: pointer; transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s, transform 0.12s, opacity 0.12s, filter 0.12s; }
.set-theme-btn:hover { border-color: var(--primary, var(--color-primary)); }
.set-theme-btn.on { border-color: var(--primary, var(--color-primary)); background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); }
.st-icon { font-size: var(--font-size-xl); }
.st-label { font-size: var(--font-size-xs); color: var(--text-secondary); }

.set-theme-editor-btn {
  margin-top: 8px; width: 100%; padding: 8px 12px; border: 1px dashed var(--border, var(--color-border));
  border-radius: 8px; background: transparent; cursor: pointer; font-size: var(--font-size-sm);
  color: var(--text-secondary); transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; text-align: center;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.set-theme-editor-btn:hover { border-color: var(--primary, var(--color-primary)); color: var(--primary, var(--color-primary)); background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); }

.set-toggle { position: relative; display: inline-block; width: 36px; height: 20px; cursor: pointer; flex-shrink: 0; }
.set-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
.set-toggle-slider { position: absolute; inset: 0; background: var(--border, var(--color-border)); border-radius: 20px; transition: background 0.2s; }
.set-toggle-slider::before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; top: 3px; background: var(--color-bg-surface); border-radius: 50%; transition: transform 0.2s; }
.set-toggle input:checked + .set-toggle-slider { background: var(--primary, var(--color-primary)); }
.set-toggle input:checked + .set-toggle-slider::before { transform: translateX(16px); }

.set-input { padding: 4px 8px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border)); border-radius: 6px; background: var(--bg, var(--color-bg-surface)); color: var(--text-color); }
.set-input:focus { outline: none; border-color: var(--primary, var(--color-primary)); }
.set-input-sm { width: 72px; text-align: center; }
.set-select { padding: 4px 8px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border)); border-radius: 6px; background: var(--bg, var(--color-bg-surface)); color: var(--text-color); cursor: pointer; }
.set-select:focus { outline: none; border-color: var(--primary, var(--color-primary)); }
.set-range-wrap { display: flex; align-items: center; gap: 8px; }
.set-range { width: 100px; accent-color: var(--primary, var(--color-primary)); }
.set-range-val { font-size: var(--font-size-sm); color: var(--text-secondary); min-width: 28px; text-align: right; font-family: monospace; }

.set-plugin-search { margin-bottom: 8px; }
.set-plugin-search .set-input { width: 100%; }
.set-plugin-list { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 2px; max-height: 320px; overflow-y: auto; }
.set-plugin-item { padding: 3px 0; display: flex; align-items: center; gap: 4px; }
.sp-grip { cursor: grab; color: var(--text-tertiary, #bbb); font-size: var(--font-size-base); line-height: 1; padding: 2px 2px; user-select: none; flex-shrink: 0; transition: color 0.1s; }
.sp-grip:hover { color: var(--text-secondary, #888); }
.sp-grip:active { cursor: grabbing; }
.sp-ghost { opacity: 0.4; background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); border-radius: 4px; }
.sp-drag { background: var(--content-bg, var(--color-bg-surface)); box-shadow: 0 4px 12px rgba(0,0,0,0.15); border-radius: 4px; }
.sp-source { font-size: var(--text-micro-font-size); color: var(--text-tertiary, var(--color-text-tertiary)); background: var(--bg-secondary, var(--color-bg-elevated)); padding: 1px 4px; border-radius: 3px; margin-right: 4px; }
.sp-toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: var(--font-size-sm); padding: 4px 6px; border-radius: 6px; transition: background 0.1s; }
.sp-toggle:hover { background: var(--hover-bg, var(--color-bg-hover)); }
.sp-toggle input { margin: 0; accent-color: var(--primary, var(--color-primary)); }
.sp-icon { font-size: var(--font-size-lg); }
.sp-label { font-size: var(--font-size-sm); }

.set-panel-widths { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-light, var(--color-border)); }
.spw-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: var(--font-size-sm); }
.spw-label { flex: 1; color: var(--text-color); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spw-value { font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); font-family: monospace; flex-shrink: 0; }
.spw-reset { width: 20px; height: 20px; border: none; background: transparent; color: var(--text-tertiary, var(--color-text-tertiary)); cursor: pointer; font-size: var(--font-size-xs); border-radius: 3px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.15s, color 0.15s; }
.spw-reset:hover { background: var(--hover-bg, var(--color-bg-hover)); color: var(--primary); }

.set-btn-row { display: flex; gap: 8px; margin-top: 6px; }
.set-btn { font-size: var(--font-size-sm); padding: 6px 14px; border-radius: 6px; border: 1px solid var(--border, var(--color-border)); background: var(--bg, var(--color-bg-surface)); cursor: pointer; color: var(--text-color); transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; }
.set-btn:hover { border-color: var(--primary, var(--color-primary)); background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); }
.set-btn-danger { color: var(--danger, var(--color-danger)); border-color: var(--danger, var(--color-danger)); }
.set-btn-danger:hover { background: var(--danger, var(--color-danger)); color: #fff; }

.set-empty { text-align: center; padding: 32px 0; color: var(--text-tertiary, var(--color-text-tertiary)); font-size: var(--font-size-sm); }

.set-chip-group { display: flex; gap: 6px; flex-wrap: wrap; }
.set-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border: 1px solid var(--border, var(--color-border)); border-radius: 14px; font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; background: var(--bg, var(--color-bg-surface)); }
.set-chip input { display: none; }
.set-chip.on { border-color: var(--primary, var(--color-primary)); background: var(--primary-light, color-mix(in srgb, var(--color-primary) 10%, transparent)); color: var(--primary, var(--color-primary)); }
.set-chip:hover { border-color: var(--primary, var(--color-primary)); }

.ss-group { margin-bottom: 10px; }
.ss-scope { font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); color: var(--text-tertiary, var(--color-text-tertiary)); margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.ss-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; border-radius: 4px; font-size: var(--font-size-sm); }
.ss-row:hover { background: var(--hover-bg, var(--color-bg-hover)); }
.ss-desc { color: var(--text-color); font-size: var(--font-size-sm); }
.ss-keys-area { display: flex; align-items: center; gap: 4px; }
.ss-keys { display: flex; align-items: center; gap: 3px; cursor: pointer; padding: 2px 6px; border: 1px solid transparent; border-radius: 4px; transition: border-color 0.1s; }
.ss-keys:hover { border-color: var(--primary, var(--color-primary)); }
.ss-keys:hover .ss-edit-icon { opacity: 1; }
.ss-edit-icon { font-size: var(--font-size-xs); opacity: 0.3; margin-left: 2px; }
.ss-kbd { display: inline-flex; align-items: center; padding: 1px 5px; font-size: var(--font-size-xs); font-family: inherit; background: var(--bg-secondary, var(--color-bg-elevated)); border: 1px solid var(--border, var(--color-border)); border-radius: 3px; box-shadow: 0 1px 0 var(--border, var(--color-border)); color: var(--text-color); }
.ss-recording { font-size: var(--font-size-sm); color: var(--primary, var(--color-primary)); font-weight: var(--font-weight-medium); padding: 2px 8px; animation: ws-pulse 0.8s infinite; cursor: pointer; }
.ss-reset { font-size: var(--font-size-base); background: none; border: none; cursor: pointer; color: var(--text-tertiary, var(--color-text-tertiary)); padding: 2px; border-radius: 3px; }
.ss-reset:hover { color: var(--danger, var(--color-danger)); background: var(--hover-bg); }

.resize-handle-right { position: absolute; right: 0; top: 0; width: 6px; height: 100%; cursor: col-resize; z-index: 10; background: transparent; transition: background 0.15s; }
.resize-handle-right:hover, .resize-handle-right:active { background: var(--primary); opacity: 0.3; }

.cp-model-field { display: flex; align-items: center; gap: 4px; flex: 1; }
.cp-model-field .set-select,
.cp-model-field .set-input { flex: 1; min-width: 0; }
.cp-fetch-btn { background: none; border: 1px solid var(--border-color, #444); border-radius: var(--radius-sm); color: var(--text-secondary); cursor: pointer; padding: 4px 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: border-color 0.15s, color 0.15s; }
.cp-fetch-btn:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.cp-fetch-btn:disabled { opacity: 0.35; cursor: not-allowed; }

/* ── 字体设置面板 ── */
.sf-layer-label { display: flex; flex-direction: column; gap: 2px; }
.set-hint-inline { font-size: var(--font-size-xs); color: var(--text-tertiary); font-weight: normal; }
.sf-layer-controls { display: flex; align-items: center; gap: 6px; }
.sf-reset-btn {
  width: 24px; height: 24px; border: none; background: transparent;
  cursor: pointer; border-radius: 4px; font-size: var(--font-size-sm);
  color: var(--text-secondary); display: flex; align-items: center; justify-content: center;
}
.sf-reset-btn:hover { background: var(--hover-bg); color: var(--primary); }

.sf-preset-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px;
}
.sf-preset-card {
  padding: 10px; border: 1px solid var(--border-light); border-radius: 8px;
  cursor: default; transition: border-color 0.15s;
}
.sf-preset-card:hover { border-color: var(--primary); }
.sf-preset-card.installed { border-color: var(--success, #4caf50); }
.sf-preset-preview {
  font-size: 20px; line-height: 1.3; margin-bottom: 6px;
  min-height: 28px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sf-preset-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); margin-bottom: 2px; }
.sf-preset-tags { font-size: var(--font-size-xs); color: var(--text-tertiary); margin-bottom: 2px; }
.sf-preset-desc { font-size: var(--font-size-xs); color: var(--text-secondary); }

.sf-import-btn {
  display: inline-block; padding: 6px 14px; border: 1px dashed var(--border-color);
  border-radius: 6px; cursor: pointer; font-size: var(--font-size-sm); color: var(--text-secondary);
  transition: border-color 0.15s, color 0.15s;
}
.sf-import-btn:hover { border-color: var(--primary); color: var(--primary); }

.sf-library-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.sf-storage-hint {
  font-size: 12px;
  color: var(--color-text-muted);
}
.sf-library-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sf-lib-card {
  position: relative;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
}
.sf-lib-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.sf-lib-name {
  font-weight: 500;
}
.sf-lib-source {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--color-surface-hover);
}
.sf-lib-source[data-source="wsfont"] { color: #5b8def; }
.sf-lib-source[data-source="raw"] { color: #8a8a8a; }
.sf-lib-source[data-source="windfonts"] { color: #4caf50; }
.sf-lib-source[data-source="preset"] { color: #9c6ade; }
.sf-lib-source[data-source="zip"] { color: #e8a838; }
.sf-lib-preview {
  font-size: 14px;
  margin: 4px 0;
  color: var(--color-text-secondary);
}
.sf-lib-meta {
  font-size: 11px;
  color: var(--color-text-muted);
}
.sf-lib-delete {
  position: absolute;
  top: 8px;
  right: 8px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 14px;
  padding: 2px 4px;
  border-radius: 3px;
}
.sf-lib-delete:hover {
  color: var(--color-danger);
  background: var(--color-surface-hover);
}
.sf-lib-group {
  margin-top: 8px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}
.sf-lib-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--color-surface-hover);
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
  font-weight: 500;
}
.sf-lib-group-name {
  flex: 1;
}
.sf-lib-group-count {
  font-size: 11px;
  color: var(--color-text-muted);
  font-weight: 400;
}
.sf-lib-group-delete {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 14px;
  padding: 2px 4px;
  border-radius: 3px;
}
.sf-lib-group-delete:hover {
  color: var(--color-danger);
  background: var(--color-surface);
}
.sf-lib-card--grouped {
  border: none;
  border-radius: 0;
  border-bottom: 1px solid var(--color-border-subtle);
}
.sf-lib-card--grouped:last-child {
  border-bottom: none;
}
.sf-layer-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 0;
}
.sf-layer-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sf-layer-variants {
  padding-left: 120px;
}
.set-select--sm {
  max-width: 160px;
  font-size: 12px;
  padding: 3px 6px;
}
</style>
