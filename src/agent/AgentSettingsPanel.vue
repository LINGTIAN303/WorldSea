<template>
  <Transition :name="embedded ? '' : 'ws-menu'">
    <div
      v-if="embedded || visible"
      :class="embedded ? 'agent-settings-embedded' : 'agent-settings agent-panel'"
      :style="embedded ? undefined : panelStyle"
      @mousedown.left="!embedded && onDragStart($event)"
    >
      <div v-if="!embedded" class="settings-drag-handle">
        <span class="menu-title"><WsIcon name="settings" size="sm" /> AI 助手设置</span>
        <button class="menu-close-btn" @click="emit('close')">✕</button>
      </div>
      <div class="settings-body">
        <div class="settings-sub-panels">
          <template v-if="embedded">
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'model' ? '' : 'model'"><WsIcon name="settings" size="xs" /> 核心</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'safety' ? '' : 'safety'"><WsIcon name="shield" size="xs" /> 安全</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'search' ? '' : 'search'"><WsIcon name="globe" size="xs" /> 搜索</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'vision' ? '' : 'vision'"><WsIcon name="eye" size="xs" /> 多模态</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'skills' ? '' : 'skills'"><WsIcon name="star" size="xs" /> Skills</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'mcp' ? '' : 'mcp'"><WsIcon name="link" size="xs" /> MCP</button>
            <button class="sub-panel-btn" :class="{ 'mode-tauri': isTauriMode, 'mode-web': !isTauriMode }" @click="settingsSubPanel = settingsSubPanel === 'terminal' ? '' : 'terminal'"><WsIcon name="keyboard" size="xs" /> 终端 <span class="mode-badge">{{ isTauriMode ? '桌面' : 'Web' }}</span></button>
          </template>
          <template v-else>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'model' ? '' : 'model'"><WsIcon name="settings" size="xs" /> 模型</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'provider' ? '' : 'provider'"><WsIcon name="link" size="xs" /> 供应商</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'safety' ? '' : 'safety'"><WsIcon name="shield" size="xs" /> 安全</button>
            <button v-if="!embedded" class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'usage' ? '' : 'usage'"><WsIcon name="dashboard" size="xs" /> 用量</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'search' ? '' : 'search'"><WsIcon name="globe" size="xs" /> 搜索</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'vision' ? '' : 'vision'"><WsIcon name="eye" size="xs" /> 多模态</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'skills' ? '' : 'skills'"><WsIcon name="star" size="xs" /> Skills</button>
            <button class="sub-panel-btn" @click="settingsSubPanel = settingsSubPanel === 'mcp' ? '' : 'mcp'"><WsIcon name="link" size="xs" /> MCP</button>
            <button class="sub-panel-btn" :class="{ 'mode-tauri': isTauriMode, 'mode-web': !isTauriMode }" @click="settingsSubPanel = settingsSubPanel === 'terminal' ? '' : 'terminal'"><WsIcon name="keyboard" size="xs" /> 终端 <span class="mode-badge">{{ isTauriMode ? '桌面' : 'Web' }}</span></button>
            <button v-if="!embedded" class="sub-panel-btn" @click="emit('reset-position')"><WsIcon name="outline" size="xs" /> 恢复位置</button>
          </template>
        </div>
        <Transition name="ws-slide-up" mode="out-in">
          <div v-if="settingsSubPanel === 'model'" key="model" class="sub-panel">
            <template v-if="embedded">
              <div class="settings-row">
                <span class="sp-row-label">供应商模式</span>
                <select v-model="settingsStore.aiProviderMode" class="settings-select" aria-label="供应商模式">
                  <option value="cloud">云端 API</option>
                  <option value="local">本地模型</option>
                  <option value="custom">自定义</option>
                </select>
              </div>
              <template v-if="settingsStore.aiProviderMode === 'cloud'">
                <div class="settings-row">
                  <span class="sp-row-label">供应商</span>
                  <div class="provider-list">
                    <button v-for="p in cloudProviderOptions" :key="p.value"
                      class="provider-list-item" :class="{ active: settingsStore.aiCloudProvider === p.value }"
                      @click="onCloudProviderChange({ target: { value: p.value } } as any)"
                      :title="p.label"
                    >
                      <img :src="p.iconUrl" class="provider-list-icon" alt="" />
                      <span class="provider-list-label">{{ p.label }}</span>
                    </button>
                  </div>
                </div>
                <div class="settings-row">
                  <span class="sp-row-label">模型</span>
                  <template v-if="currentProviderModels.length > 0">
                    <select :value="settingsStore.aiCloudModel" @change="onCloudModelChange" class="settings-select">
                      <option v-for="m in currentProviderModels" :key="m.id" :value="m.id">{{ m.name }}{{ getModelInfo(m.id)?.supportsVision ? ' (视觉)' : '' }}</option>
                    </select>
                  </template>
                  <template v-else>
                    <input type="text" class="settings-input" v-model="settingsStore.aiCloudModel" placeholder="模型 ID" />
                  </template>
                </div>
                <div class="settings-row">
                  <span class="sp-row-label">API Key</span>
                  <input type="password" class="settings-input" v-model="cloudApiKey" placeholder="sk-..." />
                </div>
              </template>
              <template v-if="settingsStore.aiProviderMode === 'local'">
                <div class="settings-row">
                  <span class="sp-row-label">端点 URL</span>
                  <input type="text" class="settings-input" v-model="settingsStore.aiLocalEndpoint" placeholder="http://localhost:11434" />
                </div>
                <div class="settings-row">
                  <span class="sp-row-label">API 类型</span>
                  <select v-model="settingsStore.aiLocalType" class="settings-select" aria-label="API 类型">
                    <option value="ollama">Ollama</option>
                    <option value="lm-studio">LM Studio</option>
                    <option value="vllm">vLLM</option>
                    <option value="llama-cpp">llama.cpp</option>
                  </select>
                </div>
                <div class="settings-row">
                  <span class="sp-row-label">模型 ID</span>
                  <input type="text" class="settings-input" v-model="settingsStore.aiLocalModel" placeholder="llama3" />
                </div>
              </template>
              <template v-if="settingsStore.aiProviderMode === 'custom'">
                <div v-if="settingsStore.customProviders.length > 0" class="settings-section">
                  <div class="sp-section-label">已配置的自定义供应商</div>
                  <div
                    v-for="cp in settingsStore.customProviders"
                    :key="cp.id"
                    class="cp-item"
                    :class="{ active: isCustomProviderActive(cp) }"
                    @click="onSelectCustomProvider(cp)"
                  >
                    <span class="cp-name">{{ cp.name || cp.baseUrl }}</span>
                    <span class="cp-model">{{ cp.modelId }}</span>
                    <button class="cp-delete" @click.stop="onDeleteCustomProvider(cp.id)" title="删除"><WsIcon name="delete" size="xs" /></button>
                  </div>
                </div>
                <div class="settings-row">
                  <span class="sp-row-label">Base URL</span>
                  <input type="text" class="settings-input" v-model="settingsStore.aiCustomBaseUrl" placeholder="https://api.example.com/v1" />
                </div>
                <div class="settings-row">
                  <span class="sp-row-label">API 类型</span>
                  <select v-model="settingsStore.aiCustomType" class="settings-select" aria-label="API 类型">
                    <option value="openai-compatible">OpenAI 兼容</option>
                    <option value="anthropic-compatible">Anthropic 兼容</option>
                  </select>
                </div>
                <div class="settings-row">
                  <span class="sp-row-label">模型 ID</span>
                  <div class="cp-model-field">
                    <select v-if="fetchedModels.length > 0" v-model="settingsStore.aiCustomModel" class="settings-select">
                      <option value="" disabled>选择模型</option>
                      <option v-for="m in fetchedModels" :key="m" :value="m">{{ m }}</option>
                    </select>
                    <input v-else type="text" class="settings-input" v-model="settingsStore.aiCustomModel" placeholder="模型 ID" />
                    <button class="cp-fetch-btn" @click="onFetchModels" :disabled="!canFetchModels || fetchingModels" :title="fetchError || '拉取模型列表'">
                      <WsIcon :name="fetchingModels ? 'loading' : 'refresh'" size="xs" />
                    </button>
                  </div>
                </div>
                <div v-if="fetchError" class="cp-fetch-error">{{ fetchError }}</div>
                <div class="settings-row">
                  <span class="sp-row-label">API Key</span>
                  <input type="password" class="settings-input" v-model="customApiKey" placeholder="sk-..." />
                </div>
                <button class="cp-save-btn" @click="onSaveCustomProvider" :disabled="!settingsStore.aiCustomBaseUrl">保存当前配置</button>
              </template>
              <div class="settings-hint">供应商配置影响 AI 助手的后端连接，切换后下次对话生效</div>
              <div style="border-top:1px solid var(--agent-border);margin:8px 0"></div>
            </template>
            <div v-if="!embedded" class="settings-section">
              <div class="settings-label">模型切换</div>
              <template v-if="settingsStore.aiProviderMode === 'cloud'">
                <div class="settings-row">
                  <template v-if="currentProviderModels.length > 0">
                    <select :value="currentModelId" @change="onModelSelectChange" class="settings-select" aria-label="模型切换">
                      <option v-for="m in currentProviderModels" :key="m.id" :value="m.id">{{ m.name }}{{ getModelInfo(m.id)?.supportsVision ? ' (视觉)' : '' }}</option>
                    </select>
                  </template>
                  <template v-else>
                    <input type="text" class="settings-input" :value="currentModelId" @change="onModelSelectChange" placeholder="模型 ID" />
                  </template>
                </div>
                <div class="settings-hint">当前供应商: {{ currentProviderLabel }}，切换供应商请前往供应商面板</div>
              </template>
              <template v-else-if="settingsStore.aiProviderMode === 'local'">
                <div class="settings-row">
                  <input type="text" class="settings-input" v-model="settingsStore.aiLocalModel" placeholder="llama3" />
                </div>
                <div class="settings-hint">本地模型通过供应商面板配置端点，此处填写模型 ID</div>
              </template>
              <template v-else>
                <div class="settings-row">
                  <input type="text" class="settings-input" v-model="settingsStore.aiCustomModel" placeholder="模型 ID" />
                </div>
                <div class="settings-hint">自定义模型通过供应商面板配置 Base URL，此处填写模型 ID</div>
              </template>
            </div>
            <div class="settings-section">
              <div class="settings-label">温度 (Temperature)</div>
              <div class="settings-row">
                <input type="range" min="0" :max="maxTemperature" :value="temperature" @input="onTemperatureChange" class="settings-slider" />
                <span class="settings-value">{{ (temperature / 100).toFixed(2) }}</span>
              </div>
            </div>
            <div class="settings-section">
              <div class="settings-label">最大输出 (Max Tokens)</div>
              <div class="settings-row">
                <input type="range" min="1024" :max="maxOutputTokens" step="1024" :value="maxTokens" @input="onMaxTokensChange" class="settings-slider" />
                <span class="settings-value">{{ maxTokens }}</span>
              </div>
            </div>
            <div class="settings-section">
              <div class="settings-label">上下文长度</div>
              <div class="settings-row">
                <input type="range" min="4096" :max="maxContextLength" step="1024" :value="contextLength" @input="onContextLengthChange" class="settings-slider" />
                <span class="settings-value">{{ formatTokens(contextLength) }}</span>
              </div>
              <div class="settings-hint">最大 {{ formatTokens(maxContextLength) }}</div>
            </div>
            <div class="settings-section">
              <div class="settings-label">AI 人格预设</div>
              <div class="settings-row">
                <select :value="personaPreset" @change="onPersonaChange" class="settings-select">
                  <option value="default">默认助手</option>
                  <option value="creative">创意写手</option>
                  <option value="analyst">严谨分析师</option>
                  <option value="storyteller">故事叙述者</option>
                </select>
              </div>
            </div>
            <div v-if="!embedded" class="settings-section">
              <div class="settings-label">回答模式</div>
              <div class="chat-mode-grid">
                <button
                  v-for="m in chatModes"
                  :key="m.value"
                  type="button"
                  class="chat-mode-card"
                  :class="{ active: chatMode === m.value, locked: lockedChatMode !== null }"
                  :disabled="lockedChatMode !== null"
                  @click="onChatModeClick(m.value)"
                >
                  <span class="chat-mode-icon"><WsIcon :name="m.icon" size="sm" /></span>
                  <span class="chat-mode-text">
                    <span class="chat-mode-label">{{ m.label }}</span>
                    <span class="chat-mode-desc">{{ m.desc }}</span>
                  </span>
                </button>
              </div>
              <div v-if="lockedChatMode !== null" class="settings-hint"><WsIcon name="lock" size="xs" /> 当前会话已锁定为「{{ chatModes?.find(m => m.value === lockedChatMode)?.label || lockedChatMode }}」模式，新建会话后可切换</div>
              <div v-else class="settings-hint">每次发送消息时使用的回答模式，与顶栏下拉框一致</div>
            </div>
          </div>
          <div v-else-if="!embedded && settingsSubPanel === 'provider'" key="provider" class="sub-panel">
            <div class="settings-row">
              <span class="sp-row-label">供应商模式</span>
              <select v-model="settingsStore.aiProviderMode" class="settings-select" aria-label="供应商模式">
                <option value="cloud">云端 API</option>
                <option value="local">本地模型</option>
                <option value="custom">自定义</option>
              </select>
            </div>
            <template v-if="settingsStore.aiProviderMode === 'cloud'">
              <div class="settings-row">
                <span class="sp-row-label">供应商</span>
                <div class="provider-list">
                  <button v-for="p in cloudProviderOptions" :key="p.value"
                    class="provider-list-item" :class="{ active: settingsStore.aiCloudProvider === p.value }"
                    @click="onCloudProviderChange({ target: { value: p.value } } as any)"
                    :title="p.label"
                  >
                    <img :src="p.iconUrl" class="provider-list-icon" alt="" />
                    <span class="provider-list-label">{{ p.label }}</span>
                  </button>
                </div>
              </div>
              <div class="settings-row">
                <span class="sp-row-label">模型</span>
                <template v-if="currentProviderModels.length > 0">
                  <select :value="settingsStore.aiCloudModel" @change="onCloudModelChange" class="settings-select">
                    <option v-for="m in currentProviderModels" :key="m.id" :value="m.id">{{ m.name }}{{ getModelInfo(m.id)?.supportsVision ? ' (视觉)' : '' }}</option>
                  </select>
                </template>
                <template v-else>
                  <input type="text" class="settings-input" v-model="settingsStore.aiCloudModel" placeholder="模型 ID" />
                </template>
              </div>
              <div class="settings-row">
                <span class="sp-row-label">API Key</span>
                <input type="password" class="settings-input" v-model="cloudApiKey" placeholder="sk-..." />
              </div>
            </template>
            <template v-if="settingsStore.aiProviderMode === 'local'">
              <div class="settings-row">
                <span class="sp-row-label">端点 URL</span>
                <input type="text" class="settings-input" v-model="settingsStore.aiLocalEndpoint" placeholder="http://localhost:11434" />
              </div>
              <div class="settings-row">
                <span class="sp-row-label">API 类型</span>
                <select v-model="settingsStore.aiLocalType" class="settings-select" aria-label="API 类型">
                  <option value="ollama">Ollama</option>
                  <option value="lm-studio">LM Studio</option>
                  <option value="vllm">vLLM</option>
                  <option value="llama-cpp">llama.cpp</option>
                </select>
              </div>
              <div class="settings-row">
                <span class="sp-row-label">模型 ID</span>
                <input type="text" class="settings-input" v-model="settingsStore.aiLocalModel" placeholder="llama3" />
              </div>
            </template>
            <template v-if="settingsStore.aiProviderMode === 'custom'">
              <div v-if="settingsStore.customProviders.length > 0" class="settings-section">
                <div class="sp-section-label">已配置的自定义供应商</div>
                <div
                  v-for="cp in settingsStore.customProviders"
                  :key="cp.id"
                  class="cp-item"
                  :class="{ active: isCustomProviderActive(cp) }"
                  @click="onSelectCustomProvider(cp)"
                >
                  <span class="cp-name">{{ cp.name || cp.baseUrl }}</span>
                  <span class="cp-model">{{ cp.modelId }}</span>
                  <button class="cp-delete" @click.stop="onDeleteCustomProvider(cp.id)" title="删除"><WsIcon name="delete" size="xs" /></button>
                </div>
              </div>
              <div class="settings-row">
                <span class="sp-row-label">Base URL</span>
                <input type="text" class="settings-input" v-model="settingsStore.aiCustomBaseUrl" placeholder="https://api.example.com/v1" />
              </div>
              <div class="settings-row">
                <span class="sp-row-label">API 类型</span>
                <select v-model="settingsStore.aiCustomType" class="settings-select" aria-label="API 类型">
                  <option value="openai-compatible">OpenAI 兼容</option>
                  <option value="anthropic-compatible">Anthropic 兼容</option>
                </select>
              </div>
              <div class="settings-row">
                <span class="sp-row-label">模型 ID</span>
                <div class="cp-model-field">
                  <select v-if="fetchedModels.length > 0" v-model="settingsStore.aiCustomModel" class="settings-select">
                    <option value="" disabled>选择模型</option>
                    <option v-for="m in fetchedModels" :key="m" :value="m">{{ m }}</option>
                  </select>
                  <input v-else type="text" class="settings-input" v-model="settingsStore.aiCustomModel" placeholder="模型 ID" />
                  <button class="cp-fetch-btn" @click="onFetchModels" :disabled="!canFetchModels || fetchingModels" :title="fetchError || '拉取模型列表'">
                    <WsIcon :name="fetchingModels ? 'loading' : 'refresh'" size="xs" />
                  </button>
                </div>
              </div>
              <div v-if="fetchError" class="cp-fetch-error">{{ fetchError }}</div>
              <div class="settings-row">
                <span class="sp-row-label">API Key</span>
                <input type="password" class="settings-input" v-model="customApiKey" placeholder="sk-..." />
              </div>
              <button class="cp-save-btn" @click="onSaveCustomProvider" :disabled="!settingsStore.aiCustomBaseUrl">保存当前配置</button>
            </template>
            <div class="settings-hint">供应商配置影响 AI 助手的后端连接，切换后下次对话生效</div>
          </div>
          <div v-else-if="settingsSubPanel === 'safety'" key="safety" class="sub-panel">
            <div class="settings-section">
              <div class="settings-row">
                <span class="settings-row-label">危险操作确认</span>
                <label class="settings-toggle"><input type="checkbox" v-model="settingsStore.aiDangerConfirm" /><span class="settings-toggle-slider"></span></label>
              </div>
              <div class="settings-hint">开启后 AI 删除实体/关系时需用户确认</div>
            </div>
          </div>
          <div v-else-if="settingsSubPanel === 'usage'" key="usage" class="sub-panel">
            <div class="usage-section-title">当前会话</div>
            <div class="usage-grid">
              <div class="usage-item">
                <span class="usage-value">{{ totalUsage.requestCount }}</span>
                <span class="usage-label">请求数</span>
              </div>
              <div class="usage-item">
                <span class="usage-value">{{ formatTokens(totalUsage.inputTokens + totalUsage.cacheReadTokens + totalUsage.cacheWriteTokens) }}</span>
                <span class="usage-label">输入 Token</span>
              </div>
              <div class="usage-item">
                <span class="usage-value">{{ formatTokens(totalUsage.outputTokens) }}</span>
                <span class="usage-label">输出 Token</span>
              </div>
              <div class="usage-item" :class="{ 'usage-cache-hit': cacheHitRate > 0 }">
                <span class="usage-value">{{ formatTokens(totalUsage.cacheReadTokens) }}</span>
                <span class="usage-label">缓存命中 ({{ cacheHitRate }}%)</span>
              </div>
              <div class="usage-item">
                <span class="usage-value">{{ formatTokens(totalUsage.cacheWriteTokens) }}</span>
                <span class="usage-label">缓存写入</span>
              </div>
              <div class="usage-item">
                <span class="usage-value">${{ calculatedCost.total.toFixed(4) }}</span>
                <span class="usage-label">总费用</span>
              </div>
              <div v-if="calculatedCost.savedByCache > 0" class="usage-item usage-saved">
                <span class="usage-value">-${{ calculatedCost.savedByCache.toFixed(4) }}</span>
                <span class="usage-label">缓存节省</span>
              </div>
            </div>
            <div class="usage-section-title">累计 (所有会话)</div>
            <div class="usage-grid">
              <div class="usage-item">
                <span class="usage-value">{{ cumulativeUsage.requestCount }}</span>
                <span class="usage-label">请求数</span>
              </div>
              <div class="usage-item">
                <span class="usage-value">{{ formatTokens(cumulativeUsage.inputTokens + cumulativeUsage.cacheReadTokens + cumulativeUsage.cacheWriteTokens) }}</span>
                <span class="usage-label">输入 Token</span>
              </div>
              <div class="usage-item">
                <span class="usage-value">{{ formatTokens(cumulativeUsage.outputTokens) }}</span>
                <span class="usage-label">输出 Token</span>
              </div>
              <div class="usage-item">
                <span class="usage-value">${{ cumulativeUsage.totalCost.toFixed(4) }}</span>
                <span class="usage-label">总费用</span>
              </div>
              <div v-if="cumulativeUsage.savedByCache > 0" class="usage-item usage-saved">
                <span class="usage-value">-${{ cumulativeUsage.savedByCache.toFixed(4) }}</span>
                <span class="usage-label">缓存节省</span>
              </div>
            </div>
          </div>
          <div v-else-if="settingsSubPanel === 'search'" key="search" class="sub-panel">
            <div class="settings-row">
              <select :value="searchEngine" @change="onSearchEngineChange" class="settings-select">
                <option value="tavily">Tavily</option>
                <option value="serpapi">SerpAPI</option>
                <option value="bing">Bing</option>
              </select>
            </div>
            <div class="settings-row" style="margin-top:6px">
              <input
                type="password"
                :value="searchApiKey"
                @input="onSearchApiKeyChange"
                placeholder="搜索 API Key"
                class="settings-input"
              />
            </div>
            <div class="settings-hint">web_search 需配置 Key；web_fetch（阅读网页）无需 Key，直接可用</div>
          </div>
          <div v-else-if="settingsSubPanel === 'vision'" key="vision" class="sub-panel">
            <div class="settings-section">
              <div class="settings-label">视觉分析</div>
              <div class="settings-hint">当主模型不支持图片理解时，Agent 会自动调用 vision_analyze 工具，通过视觉模型分析图片并将结果传回主模型</div>
              <div class="settings-row">
                <span class="settings-key">供应商</span>
                <select :value="settingsStore.visionSubAgentProvider" @change="onVisionProviderChange" class="settings-select">
                  <option value="">自动选择</option>
                  <option v-for="p in visionProviders" :key="p" :value="p">{{ visionProviderLabels[p] || p }}</option>
                </select>
              </div>
              <div class="settings-row">
                <span class="settings-key">视觉模型</span>
                <template v-if="visionSubAgentModels.length > 0">
                  <select :value="settingsStore.visionSubAgentModel" @change="onVisionModelChange" class="settings-select">
                    <option v-for="m in visionSubAgentModels" :key="m.id" :value="m.id">{{ m.name }}</option>
                  </select>
                </template>
                <template v-else>
                  <input type="text" class="settings-input" v-model="settingsStore.visionSubAgentModel" placeholder="视觉模型 ID" />
                </template>
              </div>
              <div class="settings-hint" v-if="!currentModelSupportsVision">当前主模型不支持视觉，发送图片时 Agent 将通过 vision_analyze 工具调用视觉模型分析</div>
              <div class="settings-hint" v-else>当前主模型已支持视觉，可直接识图；也可通过 vision_analyze 工具获取更详细的分析</div>
            </div>
            <div style="border-top:1px solid var(--agent-border);margin:8px 0"></div>
            <div class="settings-section">
              <div class="settings-label">图像生成</div>
              <div class="settings-hint">Agent 可通过 image_generate 工具生成图片</div>
              <div class="settings-row">
                <span class="settings-key">供应商</span>
                <select :value="imageGenProvider" @change="onImageGenProviderChange" class="settings-select">
                  <option value="">未配置</option>
                  <option v-for="p in imageGenProviders" :key="p.value" :value="p.value">{{ p.label }}</option>
                </select>
              </div>
              <div class="settings-row">
                <span class="settings-key">模型 ID</span>
                <template v-if="imageGenModelOptions.length > 0">
                  <select :value="imageGenModel" @change="onImageGenModelChange" class="settings-select">
                    <option v-for="m in imageGenModelOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
                  </select>
                </template>
                <template v-else>
                  <input type="text" class="settings-input" v-model="imageGenModel" placeholder="如 dall-e-3" />
                </template>
              </div>
              <div class="settings-row" v-if="imageGenProvider === 'custom'">
                <span class="settings-key">供应商</span>
                <select :value="imageGenCustomProviderId" @change="onImageGenCustomProviderChange" class="settings-select">
                  <option value="">选择自定义供应商</option>
                  <option v-for="cp in settingsStore.customProviders" :key="cp.id" :value="cp.id">{{ cp.name || cp.baseUrl }}</option>
                </select>
              </div>
              <div class="settings-hint" v-if="imageGenProvider">API Key 自动复用上方已配置的密钥</div>
              <div class="settings-hint" v-if="imageGenProvider">已配置 {{ imageGenProviders.find(p => p.value === (imageGenProvider === 'custom' ? `custom:${imageGenCustomProviderId}` : imageGenProvider))?.label || imageGenProvider }} 图像生成</div>
              <div class="settings-hint" v-else>未配置图像生成，image_generate 工具将不可用</div>
            </div>
            <div style="border-top:1px solid var(--agent-border);margin:8px 0"></div>
            <div class="settings-section">
              <div class="settings-label">视频生成</div>
              <div class="settings-hint">Agent 可通过 video_generate 工具生成视频（异步模式）</div>
              <div class="settings-row">
                <span class="settings-key">供应商</span>
                <select :value="videoGenProvider" @change="onVideoGenProviderChange" class="settings-select">
                  <option value="">未配置</option>
                  <option v-for="p in videoGenProviders" :key="p.value" :value="p.value">{{ p.label }}</option>
                </select>
              </div>
              <div class="settings-row">
                <span class="settings-key">模型 ID</span>
                <template v-if="videoGenModelOptions.length > 0">
                  <select :value="videoGenModel" @change="onVideoGenModelChange" class="settings-select">
                    <option v-for="m in videoGenModelOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
                  </select>
                </template>
                <template v-else>
                  <input type="text" class="settings-input" v-model="videoGenModel" placeholder="如 agnes-video-v2.0" />
                </template>
              </div>
              <div class="settings-hint" v-if="videoGenProvider">API Key 自动复用上方已配置的密钥</div>
              <div class="settings-hint" v-if="videoGenProvider">已配置 {{ videoGenProviders.find(p => p.value === videoGenProvider)?.label }} 视频生成</div>
              <div class="settings-hint" v-else>未配置视频生成，video_generate 工具将不可用</div>
            </div>
          </div>
          <div v-else-if="settingsSubPanel === 'skills'" key="skills" class="sub-panel">
            <div class="skills-list">
              <div v-for="skill in skills" :key="skill.id" class="skill-item" :class="{ disabled: !skill.enabled }">
                <span class="skill-icon"><WsIcon :name="skill.icon" size="sm" /></span>
                <div class="skill-info">
                  <span class="skill-name">{{ skill.name }}</span>
                  <span class="skill-desc">{{ skill.description }}</span>
                </div>
                <button class="skill-toggle" @click="emit('toggle-skill', skill.id)" :title="skill.enabled ? '点击禁用' : '点击启用'">
                  <WsIcon :name="skill.enabled ? 'check' : 'close'" size="xs" />
                </button>
              </div>
            </div>
          </div>
          <div v-else-if="settingsSubPanel === 'mcp'" key="mcp" class="sub-panel">
            <div class="mcp-list">
              <div v-for="conn in mcpConnections" :key="conn.id" class="mcp-item" :class="{ disabled: !conn.config.enabled }">
                <span class="mcp-status"><WsIcon :name="conn.status === 'connected' ? 'check' : conn.status === 'connecting' ? 'timeline' : conn.status === 'error' ? 'close' : 'grip'" size="xs" /></span>
                <div class="mcp-info">
                  <span class="mcp-name">{{ conn.config.name }}</span>
                  <span class="mcp-desc">{{ conn.config.transport === 'stdio' ? conn.config.command : conn.config.url }}</span>
                </div>
                <button class="mcp-delete-btn" @click="emit('remove-mcp', conn.id)" title="删除"><WsIcon name="delete" size="xs" /></button>
                <button class="skill-toggle" @click="emit('toggle-mcp', conn.id)" :title="conn.config.enabled ? '点击禁用' : '点击启用'">
                  <WsIcon :name="conn.config.enabled ? 'check' : 'close'" size="xs" />
                </button>
              </div>
            </div>
            <div v-if="mcpAdding" class="mcp-add-form">
              <div class="settings-row">
                <span class="sp-row-label">名称</span>
                <input type="text" class="settings-input" v-model="mcpForm.name" placeholder="My MCP Server" aria-label="名称" />
              </div>
              <div class="settings-row">
                <span class="sp-row-label">传输</span>
                <select class="settings-select" v-model="mcpForm.transport">
                  <option value="streamable-http">HTTP/SSE</option>
                  <option value="stdio">stdio</option>
                </select>
              </div>
              <div v-if="mcpForm.transport !== 'stdio'" class="settings-row">
                <span class="sp-row-label">URL</span>
                <input type="text" class="settings-input" v-model="mcpForm.url" placeholder="http://localhost:3000/mcp" />
              </div>
              <template v-else>
                <div class="settings-row">
                  <span class="sp-row-label">Command</span>
                  <input type="text" class="settings-input" v-model="mcpForm.command" placeholder="npx" />
                </div>
                <div class="settings-row">
                  <span class="sp-row-label">Args</span>
                  <input type="text" class="settings-input" v-model="mcpForm.argsStr" placeholder="-y @mcp/server-filesystem /tmp" />
                </div>
              </template>
              <div class="mcp-add-actions">
                <button class="sub-panel-btn" @click="emit('add-mcp', mcpFormData)">确认</button>
                <button class="sub-panel-btn" @click="mcpAdding = false">取消</button>
              </div>
            </div>
            <button v-else class="sub-panel-btn" @click="mcpAdding = true" style="width:100%">+ 手动添加</button>
            <div class="mcp-presets">
              <div class="mcp-presets-title">官方预设</div>
              <div class="mcp-presets-grid">
                <button v-for="(preset, idx) in MCP_PRESETS" :key="preset.name"
                  class="preset-btn" :class="{ added: mcpPresetAdded[idx] }"
                  @click="addPreset(preset)" :disabled="mcpPresetAdded[idx]">
                  <span class="preset-name">{{ preset.name }}</span>
                  <span class="preset-desc">{{ preset.desc }}</span>
                </button>
              </div>
            </div>
            <div class="settings-hint">MCP 服务扩展 AI 助手的外部工具能力</div>
          </div>

          <div v-else-if="settingsSubPanel === 'terminal'" key="terminal" class="sub-panel">
            <!-- CLI Agent 连接配置 -->
            <div class="settings-section">
              <div class="settings-label">CLI Agent 连接</div>
              <div class="settings-row terminal-mode-display">
                <span class="mode-indicator" :class="cliAgent.connected ? 'mode-tauri' : 'mode-web'">
                  <WsIcon :name="cliAgent.connected ? 'check-circle' : 'circle'" size="sm" />
                  {{ cliAgent.connected ? '已连接' : '未连接' }}
                </span>
                <span v-if="cliAgent.connected && cliAgent.capabilities" class="settings-hint" style="margin-left: 8px">
                  {{ cliAgent.capabilities.toolCount }} 工具可用
                </span>
              </div>
              <div class="settings-hint">
                {{ cliAgent.connected
                  ? `已连接到 CLI Agent (${cliAgent.status.url})，本地能力已激活`
                  : '连接 CLI Agent 以启用本地能力（Shell、Git、文件操作、Lint/Test/Build 等）'
                }}
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-label">服务地址</div>
              <div class="settings-row">
                <input
                  type="text"
                  class="settings-input"
                  :value="cliAgent.cliUrl"
                  @change="onCliUrlChange"
                  placeholder="http://localhost:3100"
                  aria-label="CLI Agent 服务地址"
                />
              </div>
              <div class="settings-hint">CLI Agent Server 地址（worldsmith serve 启动）</div>
            </div>

            <div class="settings-section">
              <div class="settings-row" style="gap: 8px">
                <button class="settings-btn" :disabled="cliAgent.connecting" @click="onCliAgentConnect">
                  {{ cliAgent.connecting ? '连接中...' : (cliAgent.connected ? '重新连接' : '连接') }}
                </button>
                <button v-if="cliAgent.connected" class="settings-btn settings-btn-secondary" @click="cliAgent.disconnect()">
                  断开
                </button>
              </div>
              <div v-if="cliAgent.error" class="settings-hint" style="color: #e74c3c">{{ cliAgent.error }}</div>
            </div>

            <!-- 连接成功后显示能力分类 -->
            <div v-if="cliAgent.connected && cliAgent.capabilities" class="settings-section">
              <div class="settings-label">可用能力</div>
              <div class="cli-capabilities-grid">
                <div v-for="(tools, category) in cliAgent.capabilities.categories" :key="category" class="cli-cap-category">
                  <div class="cli-cap-category-name">{{ getCategoryLabel(category as string) }}</div>
                  <div class="cli-cap-tool-count">{{ (tools as string[]).length }} 工具</div>
                </div>
              </div>
            </div>

            <!-- 原有终端配置（兼容） -->
            <div class="settings-section">
              <div class="settings-label">运行模式</div>
              <div class="settings-row terminal-mode-display">
                <span class="mode-indicator" :class="isTauriMode ? 'mode-tauri' : 'mode-web'">
                  <WsIcon :name="isTauriMode ? 'keyboard' : 'globe'" size="sm" /> {{ isTauriMode ? 'Tauri 桌面模式' : 'Web 应用模式' }}
                </span>
              </div>
              <div class="settings-hint">
                {{ isTauriMode
                  ? '当前通过 Tauri 原生 PTY 调用本地终端，无需额外服务'
                  : '当前通过 WebSocket 连接 worldsmith-server 调用终端，需启动后端服务'
                }}
              </div>
            </div>
            <div v-if="!isTauriMode" class="settings-section">
              <div class="settings-label">WebSocket 服务地址</div>
              <div class="settings-row">
                <input
                  type="text"
                  class="settings-input"
                  :value="wsServerUrl"
                  @change="onWsUrlChange"
                  placeholder="ws://localhost:3100"
                  aria-label="WebSocket 服务地址"
                />
              </div>
              <div class="settings-hint">修改后需重新打开终端生效</div>
            </div>
            <div class="settings-section">
              <div class="settings-row">
                <button class="settings-btn" :disabled="terminalConnecting" @click="onOpenTerminal">
                  {{ terminalConnecting ? '连接中...' : (isTauriMode ? '打开本地终端' : '打开远程终端') }}
                </button>
              </div>
              <div v-if="terminalConnectError" class="settings-hint" style="color: #e74c3c">{{ terminalConnectError }}</div>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import WsIcon from '../ui/WsIcon.vue'
import { usePanelDrag } from './composables/usePanelDrag'
import { useSettingsStore } from '../stores/settingsStore'
import { loadApiKey, storeApiKey, removeApiKey } from '@agent/index'
import type { MCPConnectionConfig } from '@agent/index'
import { getModelsByProvider, getDefaultModelId, getModelInfo, modelSupportsVision, getVisionModels } from './modelRegistry'
import { isTauri as detectTauri, getWsUrl, resetExecutionAdapter, createExecutionAdapter } from '@agent/execution'
import { getProviderIconUrl } from '../assets/providerIcons'
import { getAllProviderManifests, getProviderLabelMap } from '@agent/providers/provider-registry'
import { useCliAgent } from './composables/useCliAgent'

const settingsStore = useSettingsStore()

const isTauriMode = computed(() => detectTauri())
const wsServerUrl = ref(getWsUrl())
const terminalConnecting = ref(false)
const terminalConnectError = ref('')

// CLI Agent 连接
const cliAgent = useCliAgent()

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    shell: 'Shell 终端',
    git: 'Git 版本控制',
    file: '文件操作',
    project: '项目命令',
    system: '系统信息',
  }
  return labels[category] || category
}

async function onCliAgentConnect() {
  await cliAgent.connect()
}

function onCliUrlChange(e: Event) {
  const input = e.target as HTMLInputElement
  cliAgent.updateUrl(input.value)
}

async function checkTerminalConnection(): Promise<boolean> {
  const adapter = await createExecutionAdapter()
  if (adapter.isAvailable()) return true
  terminalConnecting.value = true
  terminalConnectError.value = ''
  try {
    const connected = await adapter.tryConnect()
    if (connected) return true

    if (!detectTauri()) {
      try {
        const resp = await fetch('/api/launch-server', { method: 'POST' })
        const data = await resp.json()
        if (data.ok) {
          await new Promise(r => setTimeout(r, 1000))
          resetExecutionAdapter()
          const newAdapter = createExecutionAdapter()
          const reconnected = await newAdapter.tryConnect()
          if (reconnected) return true
        }
      } catch {}
    }

    terminalConnectError.value = '连接失败，请确认 worldsmith-server 已启动'
    return false
  } catch (err) {
    terminalConnectError.value = err instanceof Error ? err.message : '连接出错'
    return false
  } finally {
    terminalConnecting.value = false
  }
}

async function onOpenTerminal(): Promise<void> {
  const connected = await checkTerminalConnection()
  if (connected) {
    emit('open-terminal')
  }
}

function onWsUrlChange(e: Event): void {
  const input = e.target as HTMLInputElement
  const url = input.value.trim()
  wsServerUrl.value = url
  try {
    localStorage.setItem('ws_server_url', url)
  } catch {}
  resetExecutionAdapter()
  terminalConnectError.value = ''
}

const cloudApiKey = ref('')
const customApiKey = ref('')
let skipCustomKeyEmit = false

const customKeyStoreId = computed(() => settingsStore.getCustomKeyStoreId(settingsStore.aiCustomBaseUrl))

onMounted(async () => {
  cloudApiKey.value = await loadApiKey(settingsStore.aiCloudProvider)
  skipCustomKeyEmit = true
  customApiKey.value = await loadApiKey(customKeyStoreId.value)
  await nextTick()
  skipCustomKeyEmit = false
})

watch(cloudApiKey, async (v) => {
  if (v) {
    await storeApiKey(settingsStore.aiCloudProvider, v)
  } else {
    await removeApiKey(settingsStore.aiCloudProvider)
  }
  emit('api-key-change', settingsStore.aiCloudProvider, v)
})
watch(customApiKey, async (v) => {
  if (v) {
    await storeApiKey(customKeyStoreId.value, v)
  } else {
    await removeApiKey(customKeyStoreId.value)
  }
  if (!skipCustomKeyEmit) {
    emit('api-key-change', 'custom', v)
  }
})
watch(() => settingsStore.aiCloudProvider, async (provider) => {
  cloudApiKey.value = await loadApiKey(provider)
})
watch(customKeyStoreId, async (newId, oldId) => {
  if (newId === oldId) return
  const currentKey = customApiKey.value
  if (currentKey && oldId) {
    await storeApiKey(oldId, currentKey)
  }
  skipCustomKeyEmit = true
  customApiKey.value = await loadApiKey(newId)
  await nextTick()
  skipCustomKeyEmit = false
})

function isCustomProviderActive(cp: { baseUrl: string; apiType: string; modelId: string }): boolean {
  return cp.baseUrl === settingsStore.aiCustomBaseUrl
    && cp.apiType === settingsStore.aiCustomType
    && cp.modelId === settingsStore.aiCustomModel
}

async function onSelectCustomProvider(cp: { baseUrl: string; apiType: string; modelId: string }): Promise<void> {
  settingsStore.aiCustomBaseUrl = cp.baseUrl
  settingsStore.aiCustomType = cp.apiType
  settingsStore.aiCustomModel = cp.modelId
  emit('provider-change', cp.apiType, cp.modelId)
}

function onDeleteCustomProvider(id: string): void {
  settingsStore.removeCustomProvider(id)
}

async function onSaveCustomProvider(): Promise<void> {
  const baseUrl = settingsStore.aiCustomBaseUrl
  if (!baseUrl) return
  const existing = settingsStore.customProviders.find(
    cp => cp.baseUrl === baseUrl && cp.apiType === settingsStore.aiCustomType
  )
  if (existing) {
    existing.modelId = settingsStore.aiCustomModel
    existing.name = deriveCustomProviderName(baseUrl)
  } else {
    settingsStore.addCustomProvider({
      name: deriveCustomProviderName(baseUrl),
      baseUrl,
      apiType: settingsStore.aiCustomType,
      modelId: settingsStore.aiCustomModel,
    })
  }
}

function deriveCustomProviderName(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    return url.hostname.replace(/^(api\.|www\.)/, '')
  } catch {
    return baseUrl
  }
}

const fetchedModels = ref<string[]>([])
const fetchingModels = ref(false)
const fetchError = ref('')

const canFetchModels = computed(() => {
  return settingsStore.aiCustomBaseUrl.trim() !== ''
    && settingsStore.aiCustomType === 'openai-compatible'
    && customApiKey.value.trim() !== ''
})

async function onFetchModels(): Promise<void> {
  const baseUrl = settingsStore.aiCustomBaseUrl.replace(/\/+$/, '')
  const apiKey = customApiKey.value
  if (!baseUrl || !apiKey) return

  fetchingModels.value = true
  fetchError.value = ''
  fetchedModels.value = []

  try {
    const isRemote = /^https?:\/\//.test(baseUrl)
    let modelsUrl: string
    const fetchHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}` }

    if (isRemote) {
      try {
        const url = new URL(baseUrl)
        fetchHeaders['X-Target-Base-Url'] = `${url.protocol}//${url.host}`
        let basePath = url.pathname.replace(/\/+$/, '')
        if (!basePath) basePath = '/v1'
        modelsUrl = `/api/custom-proxy${basePath}/models`
      } catch {
        fetchError.value = '无效的 Base URL'
        return
      }
    } else {
      modelsUrl = baseUrl.includes('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`
    }

    const res = await fetch(modelsUrl, {
      headers: fetchHeaders,
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      fetchError.value = `拉取失败: HTTP ${res.status}`
      return
    }
    const data = await res.json()
    const models: string[] = (data.data || [])
      .map((m: any) => m.id)
      .filter((id: any) => typeof id === 'string')
      .sort((a: string, b: string) => a.localeCompare(b))
    if (models.length === 0) {
      fetchError.value = '未发现可用模型'
      return
    }
    fetchedModels.value = models
  } catch (e: any) {
    fetchError.value = e.name === 'TimeoutError' ? '拉取超时' : `拉取失败: ${e.message || e}`
  } finally {
    fetchingModels.value = false
  }
}

watch(() => [settingsStore.aiCustomBaseUrl, settingsStore.aiCustomType], () => {
  fetchedModels.value = []
  fetchError.value = ''
})

const props = withDefaults(defineProps<{
  visible: boolean
  position: { x: number; y: number }
  dragged: boolean
  currentProvider: string
  currentModelId: string
  temperature: number
  maxTokens: number
  contextLength: number
  maxContextLength: number
  maxOutputTokens: number
  maxTemperature: number
  personaPreset: string
  thinkingLevel: string
  thinkingLevels: Array<{ value: string; label: string; desc: string }>
  chatMode: string
  chatModes: Array<{ value: string; icon: string; label: string; desc: string }>
  lockedChatMode: string | null
  totalUsage: { requestCount: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalCost: number; savedByCache: number }
  calculatedCost: { inputCost: number; outputCost: number; cacheReadCost: number; cacheWriteCost: number; total: number; savedByCache: number }
  cumulativeUsage: { requestCount: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalCost: number; savedByCache: number }
  cacheHitRate: number
  searchEngine: string
  searchApiKey: string
  skills: Array<{ id: string; icon: string; name: string; description: string; enabled: boolean }>
  mcpConnections: Array<{ id: string; config: { id: string; name: string; transport: string; url?: string; command?: string; args?: string[]; enabled: boolean }; status: string; tools: unknown[]; error?: string }>
  embedded?: boolean
}>(), {
  embedded: false,
  lockedChatMode: null,
})

const emit = defineEmits<{
  close: []
  dragstart: [e: MouseEvent]
  'update:temperature': [value: number]
  'update:maxTokens': [value: number]
  'update:contextLength': [value: number]
  'update:personaPreset': [value: string]
  'model-change': [provider: string, modelId: string]
  'thinking-level-change': [level: string]
  'chat-mode-change': [mode: string]
  'search-engine-change': [engine: string]
  'search-apikey-change': [key: string]
  'toggle-skill': [skillId: string]
  'toggle-mcp': [serverId: string]
  'add-mcp': [config: any]
  'remove-mcp': [serverId: string]
  'reset-position': []
  'open-terminal': []
  'api-key-change': [provider: string, apiKey: string]
  'provider-change': [provider: string, modelId: string]
}>()

const settingsSubPanel = ref('')

const currentProviderModels = computed(() => getModelsByProvider(settingsStore.aiCloudProvider))

const cloudProviderOptions = computed(() =>
  getAllProviderManifests().map(m => ({
    value: m.id,
    label: m.label,
    iconUrl: getProviderIconUrl(m.id),
  }))
)

function onCloudProviderChange(e: Event): void {
  const provider = (e.target as HTMLSelectElement).value
  settingsStore.aiCloudProvider = provider
  const defaultModelId = getDefaultModelId(provider)
  if (defaultModelId) {
    settingsStore.aiCloudModel = defaultModelId
    emit('provider-change', provider, defaultModelId)
  }
}

function onCloudModelChange(e: Event): void {
  const modelId = (e.target as HTMLSelectElement).value
  settingsStore.aiCloudModel = modelId
  emit('model-change', settingsStore.aiCloudProvider, modelId)
}

const visionProviders = computed(() => {
  const providers = new Set<string>()
  for (const m of getVisionModels()) {
    providers.add(m.provider)
  }
  return Array.from(providers)
})

const visionProviderLabels: Record<string, string> = getProviderLabelMap()

const visionSubAgentModels = computed(() => {
  const provider = settingsStore.visionSubAgentProvider
  if (!provider) return getVisionModels().map(m => ({ id: m.id, name: m.name }))
  return getModelsByProvider(provider).filter(m => {
    const info = getModelInfo(m.id)
    return info?.supportsVision ?? false
  })
})

const currentModelSupportsVision = computed(() => modelSupportsVision(settingsStore.aiCloudModel))

function onVisionProviderChange(e: Event): void {
  const provider = (e.target as HTMLSelectElement).value
  settingsStore.visionSubAgentProvider = provider
  if (provider) {
    const visionModels = getModelsByProvider(provider).filter(m => {
      const info = getModelInfo(m.id)
      return info?.supportsVision ?? false
    })
    if (visionModels.length > 0) {
      settingsStore.visionSubAgentModel = visionModels[0].id
    }
  } else {
    const allVision = getVisionModels()
    settingsStore.visionSubAgentModel = allVision.length > 0 ? allVision[0].id : ''
  }
}

function onVisionModelChange(e: Event): void {
  const modelId = (e.target as HTMLSelectElement).value
  settingsStore.visionSubAgentModel = modelId
}

const imageGenProvider = ref(localStorage.getItem('worldsmith_image_gen_provider') || '')
const imageGenModel = ref(localStorage.getItem('worldsmith_image_gen_model') || '')
const imageGenBaseUrl = ref(localStorage.getItem('worldsmith_image_gen_base_url') || '')
const imageGenCustomProviderId = ref('')

// 初始化：如果 provider 是 custom，尝试从 baseUrl 匹配自定义供应商 ID
if (imageGenProvider.value === 'custom' && imageGenBaseUrl.value) {
  const matched = settingsStore.customProviders.find(cp => cp.baseUrl === imageGenBaseUrl.value)
  if (matched) imageGenCustomProviderId.value = matched.id
}

watch(imageGenProvider, v => localStorage.setItem('worldsmith_image_gen_provider', v))
watch(imageGenModel, v => localStorage.setItem('worldsmith_image_gen_model', v))
watch(imageGenBaseUrl, v => localStorage.setItem('worldsmith_image_gen_base_url', v))

const imageGenProviders = computed(() => {
  const builtIn = [
    { value: 'openai', label: 'OpenAI (DALL-E)' },
    { value: 'openrouter', label: 'OpenRouter' },
    { value: 'agnes', label: 'Agnes AI' },
    { value: 'stepfun', label: 'StepFun' },
  ]
  const custom = settingsStore.customProviders.map(cp => ({
    value: `custom:${cp.id}`,
    label: `自定义: ${cp.name || cp.baseUrl}`,
  }))
  return [...builtIn, ...custom]
})

const imageGenModelOptions = computed(() => {
  const provider = imageGenProvider.value
  if (provider === 'openai') {
    return [
      { value: 'dall-e-3', label: 'DALL-E 3' },
      { value: 'gpt-image-1', label: 'GPT Image 1' },
    ]
  }
  if (provider === 'openrouter') {
    return getModelsByProvider('openrouter')
      .filter(m => {
        const id = m.id.toLowerCase()
        return id.includes('dall-e') || id.includes('image') || id.includes('flux') || id.includes('stable-diffusion') || id.includes('sdxl')
      })
      .map(m => ({ value: m.id, label: m.name }))
  }
  if (provider === 'agnes') {
    return [
      { value: 'agnes-image-2.1-flash', label: 'Agnes Image 2.1 Flash' },
      { value: 'agnes-image-2.0-flash', label: 'Agnes Image 2.0 Flash' },
    ]
  }
  if (provider === 'stepfun') {
    return [
      { value: 'step-image-edit-2', label: 'Step Image Edit 2' },
      { value: 'step-2x-large', label: 'Step 2X Large' },
      { value: 'step-1x-medium', label: 'Step 1X Medium' },
    ]
  }
  return []
})

function onImageGenProviderChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value
  if (value.startsWith('custom:')) {
    imageGenProvider.value = 'custom'
    const cpId = value.slice(7)
    imageGenCustomProviderId.value = cpId
    const cp = settingsStore.customProviders.find(p => p.id === cpId)
    if (cp) {
      imageGenBaseUrl.value = cp.baseUrl
      imageGenModel.value = cp.modelId
    }
  } else {
    imageGenProvider.value = value
    imageGenCustomProviderId.value = ''
    imageGenBaseUrl.value = ''
    if (value === 'openai') {
      imageGenModel.value = 'dall-e-3'
    } else if (value === 'openrouter' || value === 'stepfun') {
      const models = imageGenModelOptions.value
      imageGenModel.value = models.length > 0 ? models[0].value : ''
    } else {
      imageGenModel.value = ''
    }
  }
}

function onImageGenCustomProviderChange(e: Event): void {
  const cpId = (e.target as HTMLSelectElement).value
  imageGenCustomProviderId.value = cpId
  const cp = settingsStore.customProviders.find(p => p.id === cpId)
  if (cp) {
    imageGenBaseUrl.value = cp.baseUrl
    imageGenModel.value = cp.modelId
  }
}

function onImageGenModelChange(e: Event): void {
  imageGenModel.value = (e.target as HTMLSelectElement).value
}

// ── 视频生成配置 ──
const videoGenProvider = ref(localStorage.getItem('worldsmith_video_gen_provider') || '')
const videoGenModel = ref(localStorage.getItem('worldsmith_video_gen_model') || '')

watch(videoGenProvider, v => localStorage.setItem('worldsmith_video_gen_provider', v))
watch(videoGenModel, v => localStorage.setItem('worldsmith_video_gen_model', v))

const videoGenProviders = [
  { value: 'agnes', label: 'Agnes AI' },
  { value: 'minimax', label: 'MiniMax (海螺)' },
  { value: 'zhipu', label: '智谱 (CogVideoX)' },
  { value: 'qwen', label: '阿里 (Wan)' },
  { value: 'bytedance', label: '字节 (Seedance)' },
  { value: 'kling', label: '快手 (可灵)' },
]

const videoGenModelOptions = computed(() => {
  const provider = videoGenProvider.value
  if (provider === 'agnes') {
    return [
      { value: 'agnes-video-v2.0', label: 'Agnes Video V2.0' },
    ]
  }
  if (provider === 'minimax') {
    return [
      { value: 'MiniMax-Hailuo-02', label: 'Hailuo 02' },
      { value: 'T2V-01-Director', label: 'T2V-01 导演版' },
      { value: 'I2V-01-Director', label: 'I2V-01 导演版' },
      { value: 'T2V-01', label: 'T2V-01' },
      { value: 'I2V-01', label: 'I2V-01' },
    ]
  }
  if (provider === 'zhipu') {
    return [
      { value: 'cogvideox-2', label: 'CogVideoX-2' },
      { value: 'cogvideox', label: 'CogVideoX' },
    ]
  }
  if (provider === 'qwen') {
    return [
      { value: 'wan2.7-t2v-2026-04-25', label: 'Wan2.7 文生视频' },
      { value: 'wan2.7-i2v', label: 'Wan2.7 图生视频' },
      { value: 'wan2.2-i2v-flash', label: 'Wan2.2 Flash' },
    ]
  }
  if (provider === 'bytedance') {
    return [
      { value: 'doubao-seedance-2.0', label: 'Seedance 2.0' },
    ]
  }
  if (provider === 'kling') {
    return [
      { value: 'kling-v3', label: 'Kling V3' },
      { value: 'kling-v2.6', label: 'Kling V2.6' },
    ]
  }
  return []
})

function onVideoGenProviderChange(e: Event): void {
  const provider = (e.target as HTMLSelectElement).value
  videoGenProvider.value = provider
  const defaults: Record<string, string> = {
    agnes: 'agnes-video-v2.0',
    minimax: 'MiniMax-Hailuo-02',
    zhipu: 'cogvideox-2',
    qwen: 'wan2.7-t2v-2026-04-25',
    bytedance: 'doubao-seedance-2.0',
    kling: 'kling-v3',
  }
  videoGenModel.value = defaults[provider] || ''
}

function onVideoGenModelChange(e: Event): void {
  videoGenModel.value = (e.target as HTMLSelectElement).value
}

const mcpAdding = ref(false)
const mcpForm = ref({
  name: '',
  transport: 'streamable-http' as 'streamable-http' | 'stdio',
  url: '',
  command: '',
  argsStr: '',
})

const MCP_PRESETS = [
  { id: 'firecrawl-keyless', name: 'Firecrawl Keyless', transport: 'streamable-http' as const, url: 'https://mcp.firecrawl.dev/v2/mcp', argsStr: '', desc: '免 Key 网页搜索/抓取/爬取（每月 1000 credits）' },
  { name: 'Filesystem', transport: 'stdio' as const, command: 'npx', argsStr: '-y @modelcontextprotocol/server-filesystem C:\\Users', desc: '安全文件操作' },
  { name: 'Git', transport: 'stdio' as const, command: 'uvx', argsStr: 'mcp-server-git', desc: 'Git 仓库操作' },
  { name: 'Fetch', transport: 'stdio' as const, command: 'npx', argsStr: '-y @modelcontextprotocol/server-fetch', desc: '网页内容抓取' },
  { name: 'Memory', transport: 'stdio' as const, command: 'npx', argsStr: '-y @modelcontextprotocol/server-memory', desc: '知识图谱持久记忆' },
  { name: 'Sequential Thinking', transport: 'stdio' as const, command: 'npx', argsStr: '-y @modelcontextprotocol/server-sequentialthinking', desc: '动态反思推理' },
  { name: 'Time', transport: 'stdio' as const, command: 'npx', argsStr: '-y @modelcontextprotocol/server-time', desc: '时间与时区转换' },
  { name: 'Brave Search', transport: 'stdio' as const, command: 'npx', argsStr: '-y @brave/brave-search-mcp-server', desc: 'Brave 搜索引擎' },
  { name: 'SQLite', transport: 'stdio' as const, command: 'uvx', argsStr: 'mcp-server-sqlite', desc: 'SQLite 数据库' },
  { name: 'Puppeteer', transport: 'stdio' as const, command: 'npx', argsStr: '-y @modelcontextprotocol/server-puppeteer', desc: '浏览器自动化' },
]

const mcpPresetAdded = computed(() => {
  const ids = new Set(props.mcpConnections.map(c => c.config.id))
  const names = new Set(props.mcpConnections.map(c => c.config.name))
  return MCP_PRESETS.map(p => (p.id ? ids.has(p.id) : names.has(p.name)))
})

function addPreset(preset: typeof MCP_PRESETS[number]): void {
  const id = preset.id || `mcp-preset-${preset.name.toLowerCase().replace(/\s+/g, '-')}`
  const config: MCPConnectionConfig = {
    id,
    name: preset.name,
    transport: preset.transport,
    enabled: true,
  }
  if (preset.transport === 'stdio') {
    config.command = preset.command
    config.args = preset.argsStr.split(/\s+/).filter(Boolean)
  } else {
    config.url = preset.url
  }
  emit('add-mcp', config)
}

const mcpFormData = computed(() => ({
  id: `mcp-${Date.now()}`,
  name: mcpForm.value.name,
  transport: mcpForm.value.transport,
  url: mcpForm.value.transport !== 'stdio' ? mcpForm.value.url : undefined,
  command: mcpForm.value.transport === 'stdio' ? mcpForm.value.command : undefined,
  args: mcpForm.value.transport === 'stdio' ? mcpForm.value.argsStr.split(/\s+/).filter(Boolean) : undefined,
  enabled: true,
}))

const posX = computed({
  get: () => props.position.x,
  set: () => {},
})
const posY = computed({
  get: () => props.position.y,
  set: () => {},
})

const { onDragStart } = usePanelDrag({
  x: posX,
  y: posY,
  excludeSelector: '.settings-body, .menu-close-btn',
})

const panelStyle = computed(() => {
  if (props.dragged) {
    return { left: `${props.position.x}px`, top: `${props.position.y}px` }
  }
  return { left: `${props.position.x}px`, bottom: `${props.position.y}px` }
})

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

const currentProviderLabel = computed(() => {
  const labels = getProviderLabelMap()
  return labels[settingsStore.aiCloudProvider] || settingsStore.aiCloudProvider
})

function onModelSelectChange(e: Event): void {
  const modelId = (e.target as HTMLSelectElement).value
  emit('model-change', settingsStore.aiCloudProvider, modelId)
}

function onTemperatureChange(e: Event): void {
  emit('update:temperature', Number((e.target as HTMLInputElement).value))
}

function onMaxTokensChange(e: Event): void {
  emit('update:maxTokens', Number((e.target as HTMLInputElement).value))
}

function onContextLengthChange(e: Event): void {
  emit('update:contextLength', Number((e.target as HTMLInputElement).value))
}

function onPersonaChange(e: Event): void {
  emit('update:personaPreset', (e.target as HTMLSelectElement).value)
}

function onThinkingLevelChange(e: Event): void {
  emit('thinking-level-change', (e.target as HTMLSelectElement).value)
}

function onChatModeClick(mode: string): void {
  emit('chat-mode-change', mode)
}

function onSearchEngineChange(e: Event): void {
  emit('search-engine-change', (e.target as HTMLSelectElement).value)
}

function onSearchApiKeyChange(e: Event): void {
  emit('search-apikey-change', (e.target as HTMLInputElement).value)
}
</script>

<style scoped>
.agent-settings {
  position: fixed;
  width: 280px;
  max-height: 80vh;
  background: var(--agent-bg);
  backdrop-filter: blur(var(--agent-blur));
  border: 1px solid var(--agent-border);
  border-radius: var(--agent-radius);
  box-shadow: var(--shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.5));
  z-index: 10001;
  overflow: hidden;
  pointer-events: auto;
}

.agent-settings-embedded {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.agent-settings-embedded .settings-body {
  max-height: none;
  flex: 1;
}

.settings-drag-handle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--agent-border);
  cursor: grab;
  user-select: none;
}

.settings-drag-handle:active { cursor: grabbing }

.menu-title {
  font-size: var(--font-size-sm);
  color: var(--agent-text);
  font-family: var(--agent-font);
}

.menu-close-btn {
  background: none;
  border: none;
  color: var(--agent-text-secondary);
  cursor: pointer;
  font-size: var(--font-size-base);
}

.settings-body { padding: 12px 14px; overflow-y: auto; max-height: calc(80vh - 44px); }
.settings-section { margin-bottom: 14px }
.settings-section:last-child { margin-bottom: 0 }

.settings-label {
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
  margin-bottom: 6px;
  font-family: var(--agent-font);
}

.settings-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-row-label {
  font-size: var(--font-size-sm);
  color: var(--agent-text);
  white-space: nowrap;
  font-family: var(--agent-font);
}

.sp-row-label {
  font-size: var(--font-size-xs);
  color: var(--agent-text-secondary);
  min-width: 52px;
  flex-shrink: 0;
  font-family: var(--agent-font);
}

.settings-toggle {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
  cursor: pointer;
  flex-shrink: 0;
}

.settings-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}

.settings-toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--agent-border-color);
  border-radius: 18px;
  transition: background 0.2s;
}

.settings-toggle-slider::before {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  left: 3px;
  top: 3px;
  background: var(--color-bg-surface);
  border-radius: 50%;
  transition: transform 0.2s;
}

.settings-toggle input:checked + .settings-toggle-slider {
  background: var(--agent-primary);
}

.settings-toggle input:checked + .settings-toggle-slider::before {
  transform: translateX(14px);
}

.settings-slider {
  flex: 1;
  accent-color: var(--agent-primary);
  height: 4px;
}

.settings-value {
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
  min-width: 48px;
  text-align: right;
  font-family: var(--agent-font);
}

.settings-select {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--agent-border-color);
  border-radius: 6px;
  background: var(--agent-input-bg);
  color: var(--agent-text);
  font-size: var(--font-size-sm);
  font-family: var(--agent-font);
  outline: none;
  cursor: pointer;
}

.settings-select:focus { border-color: var(--agent-primary) }

.settings-input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--agent-border-color);
  border-radius: 6px;
  background: var(--agent-input-bg);
  color: var(--agent-text);
  font-size: var(--font-size-sm);
  font-family: var(--agent-font);
  outline: none;
}

.settings-input:focus { border-color: var(--agent-primary) }
.settings-input::placeholder { color: var(--agent-text-tertiary) }

.settings-sub-panels {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 0;
  border-top: 1px solid var(--agent-border);
  margin-top: 4px;
}

.sub-panel-btn {
  padding: 4px 10px;
  border: 1px solid var(--agent-border);
  border-radius: 6px;
  background: var(--agent-hover-bg);
  color: var(--agent-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
  font-family: var(--agent-font);
}

.sub-panel-btn:hover {
  background: var(--agent-accent-bg);
  color: var(--agent-primary);
  border-color: var(--agent-primary);
}

.sub-panel {
  padding: 8px 0;
  border-top: 1px solid var(--agent-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sub-slide-enter-active,
.sub-slide-leave-active {
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, opacity 0.2s ease, filter 0.2s ease;
  overflow: hidden;
}

.sub-slide-enter-from,
.sub-slide-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.sub-slide-enter-to,
.sub-slide-leave-from {
  opacity: 1;
  max-height: 500px;
}

.settings-hint {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  margin-top: 4px;
  font-family: var(--agent-font);
}

.skills-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.skill-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--agent-hover-bg);
  border: 1px solid transparent;
  transition: border-color 0.15s, opacity 0.15s;
}

.skill-item.disabled {
  opacity: 0.5;
}

.skill-item:hover {
  border-color: var(--agent-border);
}

.skill-icon {
  font-size: var(--font-size-lg);
  flex-shrink: 0;
}

.skill-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.skill-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--agent-text);
  font-family: var(--agent-font);
}

.skill-desc {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--agent-font);
}

.skill-toggle {
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--font-size-base);
  padding: 2px;
  flex-shrink: 0;
  transition: transform 0.1s;
}

.skill-toggle:hover {
  transform: scale(1.2);
}

.mcp-list { display: flex; flex-direction: column; gap: 6px; }
.mcp-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; background: var(--agent-hover-bg); border: 1px solid transparent; transition: border-color 0.15s, opacity 0.15s; }
.mcp-item.disabled { opacity: 0.5; }
.mcp-item:hover { border-color: var(--agent-border); }
.mcp-status { font-size: var(--font-size-xs); flex-shrink: 0; }
.mcp-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.mcp-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--agent-text); font-family: var(--agent-font); }
.mcp-desc { font-size: var(--font-size-xs); color: var(--agent-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--agent-font); }
.mcp-add-form { display: flex; flex-direction: column; gap: 6px; padding: 6px 0; border-top: 1px solid var(--agent-border); }
.mcp-add-actions { display: flex; gap: 6px; justify-content: flex-end; }
.mcp-delete-btn { background: none; border: none; cursor: pointer; font-size: var(--font-size-xs); padding: 2px 4px; opacity: 0.4; transition: opacity 0.15s; }
.mcp-delete-btn:hover { opacity: 1; }
.mcp-presets { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--agent-border); }
.mcp-presets-title { font-size: var(--font-size-xs); color: var(--agent-text-tertiary); margin-bottom: 6px; font-family: var(--agent-font); }
.mcp-presets-grid { display: flex; flex-wrap: wrap; gap: 4px; }
.preset-btn { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 5px 8px; border-radius: 6px; border: 1px solid var(--agent-border); background: var(--agent-hover-bg); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; min-width: 90px; }
.preset-btn:hover:not(:disabled) { border-color: var(--agent-accent); background: color-mix(in srgb, var(--agent-primary) 8%, transparent); }
.preset-btn.added { opacity: 0.4; cursor: default; }
.preset-name { font-size: var(--font-size-xs); font-weight: var(--font-weight-medium); color: var(--agent-text); font-family: var(--agent-font); }
.preset-desc { font-size: var(--text-micro-font-size); color: var(--agent-text-tertiary); font-family: var(--agent-font); }

.chat-mode-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
}

.chat-mode-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--agent-border);
  background: var(--agent-hover-bg);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease, opacity 0.15s ease, filter 0.15s ease;
  text-align: left;
  font-family: var(--agent-font);
  color: var(--agent-text);
}

.chat-mode-card:hover:not(.active) {
  border-color: var(--agent-accent);
  background: color-mix(in srgb, var(--agent-primary) 8%, transparent);
}

.chat-mode-card.active {
  border-color: var(--agent-accent);
  background: color-mix(in srgb, var(--agent-primary) 15%, transparent);
  box-shadow: 0 0 0 1px var(--agent-accent) inset;
}

.chat-mode-card.locked {
  opacity: 0.5;
  cursor: not-allowed;
}

.chat-mode-card.locked:hover:not(.active) {
  border-color: var(--agent-border);
  background: var(--agent-hover-bg);
}

.chat-mode-icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
}

.chat-mode-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.chat-mode-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--agent-text);
}

.chat-mode-card.active .chat-mode-label {
  color: var(--agent-accent);
}

.chat-mode-desc {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  line-height: 1.3;
}

.usage-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.usage-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 4px;
  border-radius: 8px;
  background: var(--agent-hover-bg);
  border: 1px solid var(--agent-border);
}

.usage-value {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--agent-primary);
  font-family: var(--agent-font-mono);
}

.usage-label {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  font-family: var(--agent-font);
  margin-top: 2px;
}

.usage-saved .usage-value {
  color: var(--agent-success, #22c55e);
}

.usage-section-title {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  margin-top: 8px;
  margin-bottom: 4px;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--agent-border);
}

.usage-cache-hit .usage-value {
  color: var(--agent-success, #22c55e);
}



.mode-badge {
  display: inline-block;
  font-size: var(--text-micro-font-size);
  padding: 1px 5px;
  border-radius: 4px;
  margin-left: 4px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.3px;
  vertical-align: middle;
}

.mode-tauri .mode-badge {
  background: rgba(46, 204, 113, 0.2);
  color: #2ecc71;
  border: 1px solid rgba(46, 204, 113, 0.3);
}

.mode-web .mode-badge {
  background: rgba(52, 152, 219, 0.2);
  color: #3498db;
  border: 1px solid rgba(52, 152, 219, 0.3);
}

.mode-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  font-family: var(--agent-font);
}

.mode-indicator.mode-tauri {
  background: rgba(46, 204, 113, 0.1);
  border: 1px solid rgba(46, 204, 113, 0.25);
  color: #2ecc71;
}

.mode-indicator.mode-web {
  background: rgba(52, 152, 219, 0.1);
  border: 1px solid rgba(52, 152, 219, 0.25);
  color: #3498db;
}

.terminal-mode-display {
  justify-content: center;
  padding: 4px 0;
}

.settings-btn-secondary {
  background: transparent;
  border: 1px solid var(--agent-border);
  color: var(--agent-text-secondary);
}

.settings-btn-secondary:hover {
  background: rgba(231, 76, 60, 0.1);
  border-color: rgba(231, 76, 60, 0.3);
  color: #e74c3c;
}

.cli-capabilities-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.cli-cap-category {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--agent-hover-bg);
  border: 1px solid var(--agent-border);
}

.cli-cap-category-name {
  font-size: var(--font-size-sm);
  color: var(--agent-text);
}

.cli-cap-tool-count {
  font-size: 11px;
  color: var(--agent-text-secondary);
  background: rgba(52, 152, 219, 0.1);
  padding: 1px 6px;
  border-radius: 4px;
}

.settings-btn {
  flex: 1;
  padding: 8px 14px;
  border: 1px solid var(--agent-border);
  border-radius: 8px;
  background: var(--agent-hover-bg);
  color: var(--agent-text);
  font-size: var(--font-size-sm);
  font-family: var(--agent-font);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.settings-btn:hover {
  background: var(--agent-accent-bg);
  color: var(--agent-primary);
  border-color: var(--agent-primary);
}

.sp-section-label {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  margin-bottom: 4px;
  font-family: var(--agent-font);
}

.cp-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.1s;
  font-size: var(--font-size-sm);
  color: var(--agent-text);
}

.cp-item:hover {
  background: var(--agent-hover-bg);
}

.cp-item.active {
  background: var(--agent-accent-bg);
}

.cp-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--agent-font);
}

.cp-model {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  flex-shrink: 0;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cp-delete {
  background: none;
  border: none;
  color: var(--agent-text-tertiary);
  cursor: pointer;
  font-size: var(--font-size-sm);
  opacity: 0;
  transition: opacity 0.15s;
  padding: 0 2px;
}

.cp-item:hover .cp-delete {
  opacity: 1;
}

.cp-delete:hover {
  color: var(--danger, #e74c3c);
}

.cp-save-btn {
  width: 100%;
  padding: 6px;
  margin-top: 4px;
  border: 1px dashed var(--agent-border-color);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--agent-text);
  cursor: pointer;
  font-size: var(--font-size-xs);
  transition: border-color 0.15s;
}

.cp-save-btn:hover:not(:disabled) {
  border-color: var(--agent-primary);
  color: var(--agent-primary);
}

.cp-save-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.cp-model-field {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
}

.cp-model-field .settings-select,
.cp-model-field .settings-input {
  flex: 1;
  min-width: 0;
}

.cp-fetch-btn {
  background: none;
  border: 1px solid var(--agent-border-color);
  border-radius: var(--radius-sm);
  color: var(--agent-text);
  cursor: pointer;
  padding: 4px 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: border-color 0.15s, color 0.15s;
}

.cp-fetch-btn:hover:not(:disabled) {
  border-color: var(--agent-primary);
  color: var(--agent-primary);
}

.cp-fetch-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.cp-fetch-error {
  font-size: var(--font-size-xs);
  color: var(--danger, #e74c3c);
  padding: 2px 0 0 0;
}

.provider-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
}

.provider-list-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border: 1px solid var(--agent-border);
  border-radius: 6px;
  background: var(--agent-hover-bg);
  color: var(--agent-text-secondary);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
  font-size: var(--font-size-2xs, 11px);
  white-space: nowrap;
}

.provider-list-item:hover {
  border-color: var(--agent-primary);
  color: var(--agent-primary);
  background: var(--agent-accent-bg);
}

.provider-list-item.active {
  border-color: var(--agent-primary);
  background: var(--agent-accent-bg);
  color: var(--agent-primary);
  box-shadow: 0 0 0 1px var(--agent-primary) inset;
}

.provider-list-icon {
  width: 16px;
  height: 16px;
  object-fit: contain;
  flex-shrink: 0;
}

.provider-list-label {
  line-height: 1;
}
</style>
