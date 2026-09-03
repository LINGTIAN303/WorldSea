<template>
  <Transition :name="embedded ? '' : 'ws-menu'">
    <div
      v-if="embedded || visible"
      :class="embedded ? 'agent-settings-embedded' : 'agent-settings agent-panel'"
      :style="embedded ? undefined : panelStyle"
      @mousedown.left="!embedded && onDragStart($event)"
    >
      <div v-if="!embedded" class="settings-drag-handle">
        <span class="menu-title"><WsIcon name="settings" size="sm" /> Agent 设置</span>
        <button class="menu-close-btn" title="关闭" aria-label="关闭" @click="emit('close')">
          <WsIcon name="close" :size="13" :stroke-width="1.7" />
        </button>
      </div>
      <div class="settings-body">
        <!-- 左侧纵向分组导航（仅独立悬浮面板；设置内嵌走卡片式布局） -->
        <nav v-if="!embedded" class="settings-nav">
          <div v-for="group in NAV_GROUPS" :key="group.label" class="snav-group">
            <div class="snav-group-label">{{ group.label }}</div>
            <button
              v-for="item in group.items"
              :key="item.key"
              class="snav-item"
              :class="{ on: settingsSubPanel === item.key }"
              @click="settingsSubPanel = settingsSubPanel === item.key ? '' : item.key"
            ><WsIcon :name="item.icon" size="xs" /><span>{{ item.label }}</span></button>
          </div>
          <button v-if="!embedded" class="snav-item" @click="emit('reset-position')"><WsIcon name="outline" size="xs" /><span>恢复位置</span></button>
        </nav>
        <!-- 右侧面板内容 -->
        <div class="settings-content">
        <!-- 设置内嵌（embedded）：卡片式全展开，无左侧导航 -->
        <template v-if="embedded">
          <!-- 卡片 tab（2026-09-04）：显式翻卡入口——滚轮边界续页在嵌套滚动容器下不可靠（安全卡翻不动），tab 直翻 -->
          <div class="agent-set-deck-tabs">
            <button
              v-for="(t, i) in EMBEDDED_CARD_TABS"
              :key="t"
              class="agent-set-deck-tab"
              :class="{ on: deckRef?.activeCard === i }"
              @click="deckRef?.goToCard(i)"
            >{{ t }}</button>
          </div>
          <!-- 显式轮转（叠放翻卡）：复用通用 CardDeck，当前卡完全显示，上/下一张各露一截边；滚轮边界续页 + 左列标题翻卡 -->
          <CardDeck ref="deckRef" :count="5" @change="(i) => emit('card-change', i)">
            <template #card="{ idx, cls }">
              <div class="agent-set-card deck-card" :class="cls" :data-index="idx">
              <!-- 模型卡片：收缩为「供应商类型 + 可用模型」，二级/三级弹窗承载详情（重构 2026-08-23） -->
              <template v-if="idx === 0">
                <div class="agent-set-head">模型</div>
                <ModelsSection
                  @open-type="openTypeDialog"
                  @open-model="openModelDialog"
                />
              </template>
              <!-- Skills 卡片（含「工具」区块：搜索/视觉/图像/视频 并入，C 批 2026-08-23） -->
              <template v-else-if="idx === 1">
                <div class="agent-set-head">Skills</div>

            <!-- 工具（原「能力与工具」并入 Skills） -->
            <div class="agent-set-sub">工具</div>
            <div class="skills-list">
              <div
                v-for="tool in CAPABILITY_TOOL_META"
                :key="tool.id"
                class="skill-item"
                :class="{ disabled: !capEnabled(tool.id) }"
              >
                <span class="skill-icon"><WsIcon :name="tool.icon" size="sm" /></span>
                <div class="skill-info">
                  <span class="skill-name">{{ tool.name }}</span>
                  <span class="skill-desc">{{ tool.description }}</span>
                </div>
                <button class="skill-toggle" @click="toggleCapability(tool.id)" :title="capEnabled(tool.id) ? '点击禁用' : '点击启用'">
                  <WsIcon :name="capEnabled(tool.id) ? 'check' : 'close'" size="xs" />
                </button>
                <button class="skill-toggle skill-config-btn" :class="{ on: openCapConfig === tool.id }" :title="'配置'" @click="openCapConfig = openCapConfig === tool.id ? '' : tool.id">
                  <WsIcon name="edit" size="xs" />
                </button>
              </div>
              <!-- 搜索工具配置 -->
              <div v-if="openCapConfig === 'search'" class="tool-config">
                <div class="settings-row">
                  <TuiSelect :model-value="searchEngine" :options="searchEngineOptions" @update:model-value="onSearchEngineChange" />
                </div>
                <div class="settings-row settings-row-gap">
                  <input
                    type="password"
                    :value="searchApiKey"
                    @input="onSearchApiKeyChange"
                    placeholder="搜索 API Key"
                    class="settings-input"
                  />
                </div>
                <div class="settings-hint">web_search 需配置 Key；web_fetch（阅读网页）无需 Key</div>
              </div>
              <!-- 视觉分析 / 图像生成 / 视频生成 配置（共用 VisionPanel） -->
              <div v-if="['vision', 'image', 'video'].includes(openCapConfig)" class="tool-config">
                <VisionPanel />
              </div>
            </div>

            <!-- 技能清单（D 批：分类栏） -->
            <div class="agent-set-sub">技能</div>
            <div class="ms-cat-bar" role="tablist" aria-label="技能分类">
              <button
                v-for="c in SKILL_CATS"
                :key="c.value"
                class="ms-cat" :class="{ on: activeSkillCat === c.value }"
                role="tab" :aria-selected="activeSkillCat === c.value"
                @click="activeSkillCat = c.value as any"
              >{{ c.label }}<span class="ms-cat-count">{{ catSkillCount(c.value as any) }}</span></button>
            </div>
            <div class="skills-list">
              <div v-for="skill in skillsOfCat()" :key="skill.id" class="skill-item" :class="{ disabled: !skill.enabled }">
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
                <SkillsStorePanel @skills-changed="emit('skills-changed')" />
              </template>
              <!-- MCP 卡片 -->
              <template v-else-if="idx === 2">
                <div class="agent-set-head">MCP</div>
                <McpPanel
                  :mcp-connections="mcpConnections"
                  @toggle-mcp="(serverId) => emit('toggle-mcp', serverId)"
                  @add-mcp="(config) => emit('add-mcp', config)"
                  @remove-mcp="(serverId) => emit('remove-mcp', serverId)"
                />
              </template>
              <!-- 规则卡片（H5 八文件体系 2026-08-30：规则卡片面板，八文件统一编辑入口） -->
              <template v-else-if="idx === 3">
                <div class="agent-set-head">规则</div>
                <RulesPanel />
              </template>
              <!-- 安全卡片（v2 权限分级 2026-09-04：安全级别 + 权限规则管理，嵌入式可见） -->
              <template v-else-if="idx === 4">
                <div class="agent-set-head">安全</div>
                <div class="settings-section">
                  <div class="settings-row">
                    <span class="settings-row-label">危险操作确认</span>
                    <label class="settings-toggle"><input type="checkbox" v-model="settingsStore.aiDangerConfirm" /><span class="settings-toggle-slider"></span></label>
                  </div>
                  <div class="settings-hint">开启后 Agent 删除实体/关系时需用户确认</div>
                </div>
                <div class="settings-section">
                  <div class="settings-label">工具安全级别</div>
                  <TuiSelect :model-value="securityLevel" :options="securityOptions" @update:model-value="onSecurityLevelChange" />
                  <div class="settings-hint">控制 Agent 执行工具前的确认程度，需对当前会话生效</div>
                </div>
                <div class="settings-section perm-rules">
                  <div class="settings-label">权限规则</div>
                  <div class="settings-hint">白名单=放行例外（受锁覆盖）；上锁名单=硬约束（read/command/write 三维）</div>
                  <div class="perm-sub">
                    <div class="perm-sub-label">命令白名单</div>
                    <div class="perm-add-row">
                      <input class="perm-input" v-model="allowCmdDraft" placeholder="命令子串，如 pip install" @keyup.enter="addAllowCommand" />
                      <TuiButton size="sm" variant="ghost" @click="addAllowCommand">添加</TuiButton>
                    </div>
                    <ul class="perm-list">
                      <li v-for="c in permRules.allowCommands" :key="c">
                        <code class="perm-code">{{ c }}</code>
                        <button class="perm-del" title="移除" @click="removeAllowCommand(c)"><WsIcon name="x" size="xs" /></button>
                      </li>
                      <li v-if="!permRules.allowCommands.length" class="perm-empty">暂无</li>
                    </ul>
                  </div>
                  <div class="perm-sub">
                    <div class="perm-sub-label">路径白名单</div>
                    <div class="perm-add-row">
                      <input class="perm-input" v-model="allowPathDraft" placeholder="目录或文件绝对路径" @keyup.enter="addAllowPath" />
                      <TuiButton size="sm" variant="ghost" @click="addAllowPath">添加</TuiButton>
                    </div>
                    <ul class="perm-list">
                      <li v-for="p in permRules.allowPaths" :key="p">
                        <code class="perm-code">{{ p }}</code>
                        <button class="perm-del" title="移除" @click="removeAllowPath(p)"><WsIcon name="x" size="xs" /></button>
                      </li>
                      <li v-if="!permRules.allowPaths.length" class="perm-empty">暂无</li>
                    </ul>
                  </div>
                  <div class="perm-sub">
                    <div class="perm-sub-label">上锁名单（勾选=允许）</div>
                    <div class="perm-add-row">
                      <input class="perm-input" v-model="lockPathDraft" placeholder="目录或文件绝对路径" @keyup.enter="addLock" />
                      <label class="perm-lock-dim"><input type="checkbox" v-model="lockReadOk" />读</label>
                      <label class="perm-lock-dim"><input type="checkbox" v-model="lockCmdOk" />命令</label>
                      <label class="perm-lock-dim"><input type="checkbox" v-model="lockWriteOk" />写</label>
                      <TuiButton size="sm" variant="ghost" @click="addLock">上锁</TuiButton>
                    </div>
                    <div class="settings-hint">默认 读√ 命令× 写×（仅挡写/命令，读不受限）</div>
                    <ul class="perm-list">
                      <li v-for="l in permRules.locks" :key="l.path">
                        <code class="perm-code">{{ l.path }}</code>
                        <span class="perm-lock-tags">读{{ l.read_ok ? '√' : '×' }} 命令{{ l.command_ok ? '√' : '×' }} 写{{ l.write_ok ? '√' : '×' }}</span>
                        <button class="perm-del" title="移除" @click="removeLock(l.path)"><WsIcon name="x" size="xs" /></button>
                      </li>
                      <li v-if="!permRules.locks.length" class="perm-empty">暂无</li>
                    </ul>
                  </div>
                </div>
              </template>
              </div>
            </template>
          </CardDeck>
        </template>
        <!-- 独立悬浮面板：左侧导航切换子面板 -->
        <template v-else>
        <Transition name="ws-slide-up" mode="out-in">
          <!-- 模型/核心面板（两种模式共用 ModelPanel，内部按 embedded 切换显示） -->
          <ModelPanel v-if="settingsSubPanel === 'model'" key="model"
            :embedded="embedded"
            :current-model-id="currentModelId"
            :temperature="temperature"
            :max-tokens="maxTokens"
            :context-length="contextLength"
            :max-context-length="maxContextLength"
            :max-output-tokens="maxOutputTokens"
            :max-temperature="maxTemperature"
            :cloud-api-key="cloudApiKey"
            :custom-api-key="customApiKey"
            :fetched-models="fetchedModels"
            :fetching-models="fetchingModels"
            :fetch-error="fetchError"
            :can-fetch-models="canFetchModels"
            @update:temperature="emit('update:temperature', $event)"
            @update:max-tokens="emit('update:maxTokens', $event)"
            @update:context-length="emit('update:contextLength', $event)"
            @update:cloud-api-key="cloudApiKey = $event"
            @update:custom-api-key="customApiKey = $event"
            @model-change="(provider, modelId) => emit('model-change', provider, modelId)"
            @provider-change="(provider, modelId) => emit('provider-change', provider, modelId)"
            @fetch-models="onFetchModels"
          />
          <!-- 供应商面板（仅非 embedded） -->
          <ProviderPanel v-else-if="!embedded && settingsSubPanel === 'provider'" key="provider"
            :cloud-api-key="cloudApiKey"
            :custom-api-key="customApiKey"
            :fetched-models="fetchedModels"
            :fetching-models="fetchingModels"
            :fetch-error="fetchError"
            :can-fetch-models="canFetchModels"
            @update:cloud-api-key="cloudApiKey = $event"
            @update:custom-api-key="customApiKey = $event"
            @model-change="(provider, modelId) => emit('model-change', provider, modelId)"
            @provider-change="(provider, modelId) => emit('provider-change', provider, modelId)"
            @fetch-models="onFetchModels"
          />
          <!-- 安全面板（短子面板，内联） -->
          <div v-else-if="settingsSubPanel === 'safety'" key="safety" class="sub-panel">
            <div class="settings-section">
              <div class="settings-row">
                <span class="settings-row-label">危险操作确认</span>
                <label class="settings-toggle"><input type="checkbox" v-model="settingsStore.aiDangerConfirm" /><span class="settings-toggle-slider"></span></label>
              </div>
              <div class="settings-hint">开启后 Agent 删除实体/关系时需用户确认</div>
            </div>
            <!-- A7：工具安全级别（三档，运行时切换 Rust 侧确认策略） -->
            <div class="settings-section">
              <div class="settings-label">工具安全级别</div>
              <TuiSelect :model-value="securityLevel" :options="securityOptions" @update:model-value="onSecurityLevelChange" />
              <div class="settings-hint">控制 Agent 执行工具前的确认程度，需对当前会话生效</div>
            </div>
            <!-- 权限规则（v2，2026-09-03）：白名单 + 上锁名单；优先级 上锁>白名单>档位 -->
            <div class="settings-section perm-rules">
              <div class="settings-label">权限规则</div>
              <div class="settings-hint">白名单=放行例外（受锁覆盖）；上锁名单=硬约束（read/command/write 三维）</div>

              <div class="perm-sub">
                <div class="perm-sub-label">命令白名单</div>
                <div class="perm-add-row">
                  <input class="perm-input" v-model="allowCmdDraft" placeholder="命令子串，如 pip install" @keyup.enter="addAllowCommand" />
                  <TuiButton size="sm" variant="ghost" @click="addAllowCommand">添加</TuiButton>
                </div>
                <ul class="perm-list">
                  <li v-for="c in permRules.allowCommands" :key="c">
                    <code class="perm-code">{{ c }}</code>
                    <button class="perm-del" title="移除" @click="removeAllowCommand(c)"><WsIcon name="x" size="xs" /></button>
                  </li>
                  <li v-if="!permRules.allowCommands.length" class="perm-empty">暂无</li>
                </ul>
              </div>

              <div class="perm-sub">
                <div class="perm-sub-label">路径白名单</div>
                <div class="perm-add-row">
                  <input class="perm-input" v-model="allowPathDraft" placeholder="目录或文件绝对路径" @keyup.enter="addAllowPath" />
                  <TuiButton size="sm" variant="ghost" @click="addAllowPath">添加</TuiButton>
                </div>
                <ul class="perm-list">
                  <li v-for="p in permRules.allowPaths" :key="p">
                    <code class="perm-code">{{ p }}</code>
                    <button class="perm-del" title="移除" @click="removeAllowPath(p)"><WsIcon name="x" size="xs" /></button>
                  </li>
                  <li v-if="!permRules.allowPaths.length" class="perm-empty">暂无</li>
                </ul>
              </div>

              <div class="perm-sub">
                <div class="perm-sub-label">上锁名单（勾选=允许）</div>
                <div class="perm-add-row">
                  <input class="perm-input" v-model="lockPathDraft" placeholder="目录或文件绝对路径" @keyup.enter="addLock" />
                  <label class="perm-lock-dim"><input type="checkbox" v-model="lockReadOk" />读</label>
                  <label class="perm-lock-dim"><input type="checkbox" v-model="lockCmdOk" />命令</label>
                  <label class="perm-lock-dim"><input type="checkbox" v-model="lockWriteOk" />写</label>
                  <TuiButton size="sm" variant="ghost" @click="addLock">上锁</TuiButton>
                </div>
                <div class="settings-hint">默认 读√ 命令× 写×（仅挡写/命令，读不受限）</div>
                <ul class="perm-list">
                  <li v-for="l in permRules.locks" :key="l.path">
                    <code class="perm-code">{{ l.path }}</code>
                    <span class="perm-lock-tags">读{{ l.read_ok ? '√' : '×' }} 命令{{ l.command_ok ? '√' : '×' }} 写{{ l.write_ok ? '√' : '×' }}</span>
                    <button class="perm-del" title="移除" @click="removeLock(l.path)"><WsIcon name="x" size="xs" /></button>
                  </li>
                  <li v-if="!permRules.locks.length" class="perm-empty">暂无</li>
                </ul>
              </div>
            </div>
          </div>
          <!-- 人格预设面板（内联，对应视觉稿边界与个性组） -->
          <div v-else-if="settingsSubPanel === 'persona'" key="persona" class="sub-panel">
            <div class="settings-section">
              <div class="settings-label">Agent 人格预设</div>
              <TuiSelect :model-value="personaPreset" :options="personaOptions" @update:model-value="onPersonaPresetChange" />
              <div class="settings-hint">定义 Agent 的表达风格与角色倾向，切换后后续对话生效</div>
            </div>
          </div>
          <!-- 用量面板 -->
          <UsagePanel v-else-if="settingsSubPanel === 'usage'" key="usage"
            :total-usage="totalUsage"
            :calculated-cost="calculatedCost"
            :cumulative-usage="cumulativeUsage"
            :cache-hit-rate="cacheHitRate"
          />
          <!-- 搜索面板（短子面板，内联） -->
          <div v-else-if="settingsSubPanel === 'search'" key="search" class="sub-panel">
            <div class="settings-row">
              <TuiSelect :model-value="searchEngine" :options="searchEngineOptions" @update:model-value="onSearchEngineChange" />
            </div>
            <div class="settings-row settings-row-gap">
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
          <!-- 多模态面板 -->
          <VisionPanel v-else-if="settingsSubPanel === 'vision'" key="vision" />
          <!-- Skills 面板（短子面板，内联） -->
          <!-- H5 八文件体系（2026-08-30）：规则卡片面板（rules 子面板入口） -->
          <RulesPanel v-else-if="settingsSubPanel === 'rules'" key="rules" />
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
            <SkillsStorePanel @skills-changed="emit('skills-changed')" />
          </div>
          <!-- MCP 面板 -->
          <McpPanel v-else-if="settingsSubPanel === 'mcp'" key="mcp"
            :mcp-connections="mcpConnections"
            @toggle-mcp="(serverId) => emit('toggle-mcp', serverId)"
            @add-mcp="(config) => emit('add-mcp', config)"
            @remove-mcp="(serverId) => emit('remove-mcp', serverId)"
          />
          <!-- 终端面板 -->
          <TerminalPanel v-else-if="settingsSubPanel === 'terminal'" key="terminal"
            @open-terminal="emit('open-terminal')"
          />
        </Transition>
        </template>
        </div>
      </div>
    </div>
  </Transition>
  <!-- 模型卡片二级弹窗（Teleport 到 body；由内嵌卡片 ModelsSection 触发） -->
  <ProviderTypeDialog
    v-if="modelDialog?.kind === 'type'"
    :mode="modelDialog.mode"
    :current-model-id="currentModelId"
    :temperature="temperature"
    :max-tokens="maxTokens"
    :context-length="contextLength"
    :max-context-length="maxContextLength"
    :max-output-tokens="maxOutputTokens"
    :max-temperature="maxTemperature"
    :cloud-api-key="cloudApiKey"
    :custom-api-key="customApiKey"
    :fetched-models="fetchedModels"
    :fetching-models="fetchingModels"
    :fetch-error="fetchError"
    :can-fetch-models="canFetchModels"
    @close="closeModelDialog"
    @update:temperature="emit('update:temperature', $event)"
    @update:max-tokens="emit('update:maxTokens', $event)"
    @update:context-length="emit('update:contextLength', $event)"
    @update:cloud-api-key="cloudApiKey = $event"
    @update:custom-api-key="customApiKey = $event"
    @model-change="(p, m) => emit('model-change', p, m)"
    @provider-change="(p, m) => emit('provider-change', p, m)"
  />
  <ModelParamsDialog
    v-if="modelDialog?.kind === 'model'"
    :model="modelDialog.model"
    :max-context-length="maxContextLength"
    :max-output-tokens="maxOutputTokens"
    :max-temperature="maxTemperature"
    :model-supports-vision="dialogModelInfo?.supportsVision ?? false"
    :model-supports-thinking="dialogModelInfo?.supportsThinking ?? false"
    @close="closeModelDialog"
    @save="onModelParamsSave"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { WsIcon, CardDeck } from '@worldsmith/ui-kit'
import TuiSelect from '../components/ui/TuiSelect.vue'
import TuiButton from '../components/ui/TuiButton.vue'
import RulesPanel from '@/space/panels/RulesPanel.vue'
import { usePanelDrag } from './composables/usePanelDrag'
import { useSettingsStore } from '@/stores/settingsStore'
import { useModelApiKeyConfig } from './composables/useModelApiKeyConfig'
import { useCustomModelFetch } from './composables/useCustomModelFetch'
import { invoke } from '@/agent/composables/transport'
import SkillsStorePanel from './SkillsStorePanel.vue'
// 拆分出的子面板
import ModelPanel from './panels/ModelPanel.vue'
import ProviderPanel from './panels/ProviderPanel.vue'
import UsagePanel from './panels/UsagePanel.vue'
import VisionPanel from './panels/VisionPanel.vue'
import McpPanel from './panels/McpPanel.vue'
import TerminalPanel from './panels/TerminalPanel.vue'
// 模型卡片重构（2026-08-23）：一级平铺卡片 + 二级弹窗
import ModelsSection from './panels/model/ModelsSection.vue'
import ProviderTypeDialog from './panels/model/ProviderTypeDialog.vue'
import ModelParamsDialog from './panels/model/ModelParamsDialog.vue'
import { getModelInfo } from '@worldsmith/agent-runtime'
import { useAgentRust } from './composables/useAgentRust'

const settingsStore = useSettingsStore()
const { updateModel } = useAgentRust()

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
  totalUsage: { requestCount: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalCost: number; savedByCache: number }
  calculatedCost: { inputCost: number; outputCost: number; cacheReadCost: number; cacheWriteCost: number; total: number; savedByCache: number }
  cumulativeUsage: { requestCount: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalCost: number; savedByCache: number }
  cacheHitRate: number
  searchEngine: string
  searchApiKey: string
  skills: Array<{ id: string; icon: string; name: string; description: string; enabled: boolean; category?: 'domain' | 'action' | 'persona' }>
  mcpConnections: Array<{ id: string; config: { id: string; name: string; transport: string; url?: string; command?: string; args?: string[]; enabled: boolean }; status: string; tools: unknown[]; error?: string }>
  embedded?: boolean
}>(), {
  embedded: false,
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
  'search-engine-change': [engine: string]
  'search-apikey-change': [key: string]
  'toggle-skill': [skillId: string]
  'skills-changed': []
  'toggle-mcp': [serverId: string]
  'add-mcp': [config: any]
  'remove-mcp': [serverId: string]
  'reset-position': []
  'open-terminal': []
  'api-key-change': [provider: string, apiKey: string]
  'provider-change': [provider: string, modelId: string]
  'security-level-change': [level: string]
  'card-change': [index: number]
}>()

// ── 模型 API Key 加载/持久化（拆分至 useModelApiKeyConfig） ──
const { cloudApiKey, customApiKey } = useModelApiKeyConfig({
  onApiKeyChange: (provider, apiKey) => emit('api-key-change', provider, apiKey),
})

// ── 自定义供应商模型拉取（拆分至 useCustomModelFetch） ──
const { fetchedModels, fetchingModels, fetchError, canFetchModels, onFetchModels } = useCustomModelFetch({
  customApiKey,
})

// 当前展开的子面板
const settingsSubPanel = ref('')

// ── 叠放翻卡：复用通用 CardDeck（翻卡逻辑/样式已下沉 ui-kit useCardDeck + CardDeck.vue） ──
const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)
defineExpose({ goToCard: (i: number) => deckRef.value?.goToCard(i) })

/** 嵌入式设置卡片 tab（2026-09-04）：显式翻卡入口（模型/Skills/MCP/规则/安全） */
const EMBEDDED_CARD_TABS = ['模型', 'Skills', 'MCP', '规则', '安全']

// ── C 批：能力工具并入 Skills（搜索/视觉分析/图像生成/视频生成） ──
const CAPABILITY_TOOL_META = [
  { id: 'search', icon: 'search', name: '搜索', description: 'web_search 联网检索' },
  { id: 'vision', icon: 'eye', name: '视觉分析', description: 'vision_analyze 图片理解' },
  { id: 'image', icon: 'layout', name: '图像生成', description: 'image_generate 文生图' },
  { id: 'video', icon: 'play', name: '视频生成', description: 'video_generate 文生视频（异步）' },
]
const CAP_TOOL_KEY = 'worldsmith_capability_tools'
const openCapConfig = ref('')
function capEnabled(id: string): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem(CAP_TOOL_KEY) || '{}')
    return raw[id] !== false
  } catch {
    return true
  }
}
function toggleCapability(id: string): void {
  let raw: Record<string, boolean> = {}
  try {
    raw = JSON.parse(localStorage.getItem(CAP_TOOL_KEY) || '{}')
  } catch {}
  raw[id] = !capEnabled(id)
  try {
    localStorage.setItem(CAP_TOOL_KEY, JSON.stringify(raw))
  } catch {}
}

// ── D 批：Skills 分类栏（domain/action/persona） ──
const SKILL_CATS = [
  { value: 'all', label: '全部' },
  { value: 'domain', label: '领域' },
  { value: 'action', label: '操作' },
  { value: 'persona', label: '人格' },
]
const activeSkillCat = ref<'all' | 'domain' | 'action' | 'persona'>('all')
function skillsOfCat(): Array<{ id: string; icon: string; name: string; description: string; enabled: boolean; category?: 'domain' | 'action' | 'persona' }> {
  if (activeSkillCat.value === 'all') return props.skills
  return props.skills.filter((s) => s.category === activeSkillCat.value)
}
function catSkillCount(c: 'all' | 'domain' | 'action' | 'persona'): number {
  if (c === 'all') return props.skills.length
  return props.skills.filter((s) => s.category === c).length
}

// ── 模型卡片二级弹窗状态（2026-08-23 重构） ──
type ModelDialogState =
  | null
  | { kind: 'type'; mode: 'cloud' | 'local' | 'custom' }
  | { kind: 'model'; model: { id: string; name: string } }
const modelDialog = ref<ModelDialogState>(null)

function openTypeDialog(mode: 'cloud' | 'local' | 'custom'): void {
  modelDialog.value = { kind: 'type', mode }
}
function openModelDialog(model: { id: string; name: string }): void {
  modelDialog.value = { kind: 'model', model }
}
function closeModelDialog(): void {
  modelDialog.value = null
}
/** 弹窗模型对应的 registry 信息（用于视觉/思考能力提示） */
const dialogModelInfo = computed(() => {
  if (modelDialog.value?.kind !== 'model') return null
  return getModelInfo(modelDialog.value.model.id) ?? null
})
/** 模型参数保存：模型级预设已写 localStorage + 传导 Rust 会话（采样参数 + 总步骤预算） */
function onModelParamsSave(params: { contextLength: number; maxTokens: number; temperature: number; topP: number; topK: number; totalSteps: number; thinking: boolean; inputImage: boolean }): void {
  // 模型参数保存链（2026-09-01 接通 CONTRACT 缺口）：
  // - localStorage 已在 ModelParamsDialog 内写入（按模型 id 键存，表单重建时读回）
  // - 此处向 Rust 会话传导采样参数 + 总步骤预算（temperature/topP/topK/maxTokens/totalSteps）
  //   updateModel 会写 AgentLoopConfig（topP 内部 ÷100；totalSteps clamp 1~500）
  const provider = props.currentProvider
  const modelId = props.currentModelId
  if (!provider || !modelId) return
  void updateModel(
    provider,
    modelId,
    undefined,
    undefined,
    undefined,
    params.maxTokens,
    params.temperature,
    params.topP,
    params.topK,
    params.thinking,
    params.totalSteps,
  )
}

/** 子面板纵向分组导航（模型与推理 / 能力与工具 / 边界与个性） */
const NAV_GROUPS = [
  {
    label: '模型与推理',
    items: [
      { key: 'model', label: '核心', icon: 'settings' },
      { key: 'provider', label: '供应商', icon: 'link' },
      { key: 'usage', label: '用量', icon: 'dashboard' },
    ],
  },
  {
    label: '能力与工具',
    items: [
      { key: 'rules', label: '规则', icon: 'manuscript' },
      { key: 'skills', label: 'Skills', icon: 'star' },
      { key: 'mcp', label: 'MCP', icon: 'link' },
      { key: 'search', label: '搜索', icon: 'globe' },
      { key: 'vision', label: '多模态', icon: 'eye' },
      { key: 'terminal', label: '终端', icon: 'keyboard' },
    ],
  },
  {
    label: '边界与个性',
    items: [
      { key: 'safety', label: '安全', icon: 'shield' },
      { key: 'persona', label: '人格预设', icon: 'person' },
    ],
  },
]

// ── 面板拖拽（仅非 embedded 模式） ──
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

// ── 搜索面板事件转发（短子面板内联） ──
function onSearchEngineChange(v: string): void {
  emit('search-engine-change', v)
}

function onSearchApiKeyChange(e: Event): void {
  emit('search-apikey-change', (e.target as HTMLInputElement).value)
}

// ── 人格预设/思考级别面板事件转发（边界与个性组） ──
function onPersonaPresetChange(v: string): void {
  emit('update:personaPreset', v)
}

// A7 工具安全级别：加载 settingsStore 持久值，切换时 emit（SpaceAgentSettingsPanel 转发到 useAgentRust.setSecurityLevel）
const securityLevel = ref(settingsStore.agentSecurityLevel || 'dangerous_only')

function onSecurityLevelChange(v: string): void {
  settingsStore.agentSecurityLevel = v
  emit('security-level-change', v)
}

// ── TuiSelect 选项集（替代原生 select；thinkingLevels 用 props 直传，值/label 对齐） ──
const searchEngineOptions: Array<{ value: string; label: string }> = [
  { value: 'tavily', label: 'Tavily' },
  { value: 'serpapi', label: 'SerpAPI' },
  { value: 'bing', label: 'Bing' },
]
const personaOptions: Array<{ value: string; label: string }> = [
  { value: 'default', label: '默认助手' },
  { value: 'creative', label: '创意写手' },
  { value: 'analyst', label: '严谨分析师' },
  { value: 'storyteller', label: '故事叙述者' },
]
const securityOptions: Array<{ value: string; label: string }> = [
  { value: 'plan', label: '只读研究（禁用写/命令）' },
  { value: 'interact', label: '交互确认（默认，危险操作确认+可加白名单）' },
  { value: 'autopilot', label: '自动巡航（白名单放行+上锁名单拦截）' },
]

// ── v2 权限规则（2026-09-03）：白名单 + 上锁名单 CRUD ──
interface PermRules {
  allowCommands: string[]
  allowPaths: string[]
  locks: Array<{ path: string; read_ok: boolean; command_ok: boolean; write_ok: boolean }>
}
const permRules = ref<PermRules>({ allowCommands: [], allowPaths: [], locks: [] })
const allowCmdDraft = ref('')
const allowPathDraft = ref('')
const lockPathDraft = ref('')
const lockReadOk = ref(true)
const lockCmdOk = ref(false)
const lockWriteOk = ref(false)

async function loadPermRules(): Promise<void> {
  try {
    permRules.value = (await invoke<PermRules>('cmd_perm_rules_get')) ?? { allowCommands: [], allowPaths: [], locks: [] }
  } catch (e) {
    console.warn('[AgentSettings] 加载权限规则失败:', e)
  }
}
async function refreshAfter(act: () => Promise<unknown>): Promise<void> {
  try {
    await act()
  } catch (e) {
    console.warn('[AgentSettings] 权限规则操作失败:', e)
  }
  await loadPermRules()
}
function addAllowCommand(): void {
  const v = allowCmdDraft.value.trim()
  if (!v) return
  allowCmdDraft.value = ''
  void refreshAfter(() => invoke('cmd_perm_rule_add_allow_command', { pattern: v }))
}
function removeAllowCommand(v: string): void {
  void refreshAfter(() => invoke('cmd_perm_rule_remove_allow_command', { pattern: v }))
}
function addAllowPath(): void {
  const v = allowPathDraft.value.trim()
  if (!v) return
  allowPathDraft.value = ''
  void refreshAfter(() => invoke('cmd_perm_rule_add_allow_path', { path: v }))
}
function removeAllowPath(v: string): void {
  void refreshAfter(() => invoke('cmd_perm_rule_remove_allow_path', { path: v }))
}
function addLock(): void {
  const v = lockPathDraft.value.trim()
  if (!v) return
  lockPathDraft.value = ''
  void refreshAfter(() =>
    invoke('cmd_perm_rule_add_lock', { path: v, readOk: lockReadOk.value, commandOk: lockCmdOk.value, writeOk: lockWriteOk.value }),
  )
}
function removeLock(v: string): void {
  void refreshAfter(() => invoke('cmd_perm_rule_remove_lock', { path: v }))
}
onMounted(() => {
  void loadPermRules()
})
</script>

<style>
/* ── 嵌入式设置卡片 tab（2026-09-04）：显式翻卡入口 ── */
.agent-set-deck-tabs {
  display: flex;
  gap: 6px;
  padding: 0 4px 10px;
  overflow-x: auto;
}
.agent-set-deck-tab {
  flex-shrink: 0;
  padding: 4px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-subtle);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}
.agent-set-deck-tab:hover {
  color: var(--text-primary);
  background: var(--bg-hover, var(--bg-subtle));
}
.agent-set-deck-tab.on {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent);
}
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
  /* 设置内嵌：叠放翻卡，滚动由卡片内部 / 翻卡接管（无左侧导航） */
  flex-direction: column;
  overflow: hidden;
  gap: 10px;
}

.agent-settings-embedded .settings-content {
  overflow: hidden;
  padding: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* 设置内嵌卡片（与其它设置面板的 set-card 视觉一致）；背景用统一 surface token（原引用未定义的 --color-bg-surface 致卡片背景失效） */
.agent-set-card {
  background: var(--bg-surface);
  border-radius: var(--radius-md, 8px);
  padding: 14px 16px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06), 0 0 0 1px var(--border, var(--color-border));
  flex-shrink: 0;
}

/* 叠放翻卡（card-deck / deck-card / anim-* 三态 + 翻转动画 + data-reduce-motion 降级）
   共享样式已下沉至 ui-kit 的 CardDeck.vue，此处不再重复定义（2026-08-23） */
.agent-set-head {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-tertiary, var(--color-text-tertiary));
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.agent-set-sub {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--text-tertiary, var(--color-text-tertiary));
  margin: 12px 0 6px;
  padding-top: 8px;
  border-top: 1px solid var(--border, var(--color-border));
}
.agent-set-sub:first-of-type {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
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

.settings-body {
  display: flex;
  gap: 10px;
  min-height: 0;
  flex: 1;
  padding: 10px;
  overflow: hidden;
}
.settings-section { margin-bottom: 14px }
.settings-section:last-child { margin-bottom: 0 }

/* 纵向分组导航 */
.settings-nav {
  width: 118px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--agent-border);
  padding-right: 8px;
}

.snav-group { margin-bottom: 12px }
.snav-group:last-child { margin-bottom: 0 }

.snav-group-label {
  font-size: var(--font-size-2xs, 11px);
  color: var(--agent-text-tertiary);
  padding: 0 6px 4px;
  letter-spacing: 0.4px;
  font-family: var(--agent-font);
}

.snav-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--agent-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  margin-bottom: 2px;
  transition: background 0.15s, color 0.15s;
  font-family: var(--agent-font);
  text-align: left;
}

.snav-item:hover {
  background: var(--agent-hover-bg);
  color: var(--agent-text);
}

.snav-item.on {
  background: var(--agent-accent-bg);
  color: var(--agent-primary);
}

/* 右侧面板内容 */
.settings-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 2px 4px;
}

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
/* 行间纵向留白：替代内联 margin-top（统一视觉节奏） */
.settings-row-gap {
  margin-top: 6px;
}
/* 配置层 TuiSelect：撑满所在 row 的剩余宽度（替代原生 select 的 flex:1） */
.agent-settings .tui-select,
.agent-settings-embedded .tui-select {
  flex: 1;
  min-width: 0;
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
  border-radius: var(--radius-pill, 18px);
  transition: background 0.2s;
}

.settings-toggle-slider::before {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  left: 3px;
  top: 3px;
  background: var(--bg-surface);
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
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-sm);
  background: var(--agent-input-bg);
  color: var(--agent-text);
  font-size: var(--font-size-sm);
  font-family: var(--agent-font);
  outline: none;
}

.settings-input:focus { border-color: var(--agent-primary) }
.settings-input::placeholder { color: var(--agent-text-tertiary) }

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

.settings-key {
  font-size: var(--font-size-xs);
  color: var(--agent-text-secondary);
  min-width: 52px;
  flex-shrink: 0;
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
  border-radius: var(--radius-mid);
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

/* C 批：能力工具配置展开块 + 配置按钮 */
.skill-config-btn { opacity: 0; transition: opacity 0.15s, color 0.15s; }
.skill-item:hover .skill-config-btn { opacity: 1; }
.skill-config-btn.on { opacity: 1; color: var(--agent-primary); }
.tool-config {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--agent-hover-bg);
  border: 1px solid var(--agent-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tool-config .settings-row { display: flex; align-items: center; gap: 8px; }

/* D 批：Skills/MCP 分类栏（与 ModelsSection 视觉一致的胶囊 bar，此处作用于 Agent 设置卡片区） */
.ms-cat-bar { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
.ms-cat {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: var(--radius-pill, 999px);
  border: 1px solid var(--agent-border);
  background: var(--agent-hover-bg);
  color: var(--text-secondary, var(--agent-text-secondary));
  font-size: var(--font-size-xs);
  cursor: pointer; transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.ms-cat:hover { color: var(--color-text, var(--agent-text)); }
.ms-cat.on { border-color: var(--color-primary, var(--agent-primary)); color: var(--color-primary, var(--agent-primary)); background: color-mix(in srgb, var(--agent-primary, var(--color-primary)) 12%, transparent); }
.ms-cat-count { font-size: var(--font-size-2xs, 10px); opacity: 0.7; }

.mcp-list { display: flex; flex-direction: column; gap: 6px; }
.mcp-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--radius-mid); background: var(--agent-hover-bg); border: 1px solid transparent; transition: border-color 0.15s, opacity 0.15s; }
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
  border-radius: var(--radius-mid);
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
  border-radius: var(--radius-mid);
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
  color: var(--success, #16a34a);
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
  color: var(--success, #16a34a);
}



.mode-badge {
  display: inline-block;
  font-size: var(--text-micro-font-size);
  padding: 1px 5px;
  border-radius: var(--radius-xs);
  margin-left: 4px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.3px;
  vertical-align: middle;
}

.mode-tauri .mode-badge {
  background: var(--success-soft, rgba(46, 204, 113, 0.2));
  color: var(--success, #2ecc71);
  border: 1px solid color-mix(in srgb, var(--success, #2ecc71) 30%, transparent);
}

.mode-web .mode-badge {
  background: var(--info-soft, rgba(52, 152, 219, 0.2));
  color: var(--info, #3498db);
  border: 1px solid color-mix(in srgb, var(--info, #3498db) 30%, transparent);
}

.mode-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-mid);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  font-family: var(--agent-font);
}

.mode-indicator.mode-tauri {
  background: var(--success-soft, rgba(46, 204, 113, 0.1));
  border: 1px solid color-mix(in srgb, var(--success, #2ecc71) 25%, transparent);
  color: var(--success, #2ecc71);
}

.mode-indicator.mode-web {
  background: var(--info-soft, rgba(52, 152, 219, 0.1));
  border: 1px solid color-mix(in srgb, var(--info, #3498db) 25%, transparent);
  color: var(--info, #3498db);
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
  background: var(--danger-soft, rgba(231, 76, 60, 0.1));
  border-color: color-mix(in srgb, var(--danger, #dc2626) 30%, transparent);
  color: var(--danger);
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
  border-radius: var(--radius-sm);
  background: var(--agent-hover-bg);
  border: 1px solid var(--agent-border);
}

.cli-cap-category-name {
  font-size: var(--font-size-sm);
  color: var(--agent-text);
}

.cli-cap-tool-count {
  font-size: var(--fs-xs);
  color: var(--agent-text-secondary);
  background: var(--info-soft, rgba(52, 152, 219, 0.1));
  padding: 1px 6px;
  border-radius: var(--radius-xs);
}

.settings-btn {
  flex: 1;
  padding: 8px 14px;
  border: 1px solid var(--agent-border);
  border-radius: var(--radius-mid);
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
  border-radius: var(--radius-sm);
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

/* ── v2 权限规则（2026-09-03）：白名单 / 上锁名单 ── */
.perm-sub {
  margin-top: 10px;
}
.perm-sub-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.perm-add-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.perm-input {
  flex: 1;
  min-width: 120px;
  background: var(--bg-input, var(--bg-subtle));
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text-primary);
  outline: none;
}
.perm-input:focus {
  border-color: var(--accent);
}
.perm-list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 140px;
  overflow-y: auto;
}
.perm-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  background: var(--bg-subtle);
  border-radius: var(--radius-sm);
  font-size: 12px;
}
.perm-code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, monospace);
  color: var(--text-primary);
}
.perm-lock-tags {
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 11px;
}
.perm-del {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  border-radius: 4px;
  cursor: pointer;
}
.perm-del:hover {
  color: var(--danger);
  background: var(--danger-soft);
}
.perm-lock-dim {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.perm-lock-dim input {
  accent-color: var(--accent);
}
.perm-empty {
  color: var(--text-tertiary);
  font-size: 12px;
}
</style>
