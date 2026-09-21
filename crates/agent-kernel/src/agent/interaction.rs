use std::sync::atomic::Ordering;

use tracing::{debug, info, warn};

use crate::backend::ThinkingLevel;
use crate::llm::config::ProviderConfig;
use crate::types::{MessageRole, OrchestratorMessage};

use super::{AgentError, AgentLoop, AgentStateSnapshot};

// ─── IAgentBackend 接口补全（阶段 1.3 P0 修复） ─────────────

impl AgentLoop {
    /// 中途引导（steer）— A3 三通道之一（详 [`crate::agent::input`]）
    ///
    /// 对应前端 `IAgentBackend.steer(text)`，但投递机制自 A3 起统一为 **inbox**：
    /// - 运行中：入队，由下一轮 LLM 请求**之前**的 pre-step 准入注入
    ///   （`meta.input_kind = "steer"`；backend 侧自 A3 起不再持有 steer 缓冲）
    /// - 空闲：**唤醒**（对齐 dsh `steer` 语义）——本调用同步跑完一轮，
    ///   调用方（命令层）如需非阻塞可自行 `tokio::spawn`
    pub async fn steer(&self, text: String) -> Result<super::input::SubmitOutcome, AgentError> {
        self.submit_input(super::input::InputKind::Steer, text).await
    }

    /// 跟进提问（保留历史，开始新一轮 ReAct 循环）— 语义 = A3 `FollowUp` 通道（唤醒）
    ///
    /// 对应前端 `IAgentBackend.followUp(text)`。
    /// 与 `run` 的区别：不重置 current_iteration，不清除 messages
    /// （A3 备注：`run` 自身即为「新任务周期」语义；本方法保持既有实现不动）。
    pub async fn follow_up(&self, text: String) -> Result<String, AgentError> {
        info!("AgentLoop followUp，输入长度: {}", text.len());
        // 检查中断
        {
            let state = self.state.lock().await;
            if state.aborted {
                return Err(AgentError::Aborted);
            }
        }
        // 直接调用 run（run 内部会推入 user 消息并启动循环）
        self.run(text).await
    }

    /// 清空对话历史 — 对应前端 `IAgentBackend.clearHistory()`
    ///
    /// 重置 state.messages、current_iteration 与总步骤预算，但保留 aborted 标志。
    pub async fn clear_history(&self) {
        let mut state = self.state.lock().await;
        state.messages.clear();
        state.current_iteration = 0;
        state.total_steps_used = 0;
        state.budget_warn_80_notified = false;
        state.budget_warn_95_notified = false;
        state.budget_final_notified = false;
        debug!("AgentLoop clear_history: 已清空 messages");
    }

    /// 更新思考级别 — 对应前端 `IAgentBackend.updateThinkingLevel(level)`
    ///
    /// 仅修改 config.thinking_level，不影响消息历史。
    pub fn update_thinking_level(&self, level: ThinkingLevel) {
        if let Ok(mut guard) = self.config.write() {
            guard.thinking_level = Some(level);
            debug!("update_thinking_level: 已更新为 {:?}", level);
        } else {
            warn!("update_thinking_level: config RwLock poisoned");
        }
    }

    /// 清理上下文窗口 — 对应前端 `IAgentBackend.trimContext(upToIndex)`
    ///
    /// 同时同步 state.messages 和 backend 内部 messages，
    /// 保证两边一致（避免 AgentLoop 与 backend 状态漂移）。
    pub async fn trim_context(&self, up_to_index: usize) -> Result<(), AgentError> {
        // 1. backend 端清理
        self.backend.trim_context(up_to_index).await?;

        // 2. state 端同步清理
        let mut state = self.state.lock().await;
        let total = state.messages.len();
        if up_to_index >= total {
            state.messages.clear();
        } else {
            state.messages.drain(0..up_to_index);
        }
        debug!(
            "trim_context: 移除前 {} 条，剩余 {} 条",
            up_to_index,
            state.messages.len()
        );
        Ok(())
    }

    /// 按**删除掩码**清理上下文（A1 己2①：保留契约的落地手段）
    ///
    /// 与 [`Self::trim_context`] 的区别：后者只能删**前缀**（`up_to_index` 之前全部），
    /// 而保留契约要求「删掉中段的陈旧内容、同时保住更旧的受保护消息」
    /// （如 `state.messages[0]` 的系统提示词、被标为决策的早期消息）——
    /// 前缀语义无法表达，故改为按掩码逐条筛除。
    ///
    /// 同步两边状态的方式：先 `set_messages` 覆盖 backend，再覆盖 `state.messages`
    /// （与 [`Self::set_runtime_messages`] 同源；`trim_context` 的 `up_to_index`
    /// 语义保持不变，外部调用方不受影响）。
    ///
    /// 返回实际删除的条数；掩码为空或全 `false` 时不触碰任何状态。
    pub async fn trim_context_dropping(&self, drop_mask: &[bool]) -> Result<usize, AgentError> {
        let dropped = drop_mask.iter().filter(|d| **d).count();
        if dropped == 0 {
            return Ok(0);
        }

        // 1. 计算保留后的消息序列（长度不变或变短；此处以 state 为准）
        let kept: Vec<crate::types::OrchestratorMessage> = {
            let state = self.state.lock().await;
            if drop_mask.len() != state.messages.len() {
                warn!(
                    "trim_context_dropping: 掩码长度 {} 与消息数 {} 不一致，跳过以避免错删",
                    drop_mask.len(),
                    state.messages.len()
                );
                return Ok(0);
            }
            state
                .messages
                .iter()
                .enumerate()
                .filter(|(i, _)| !drop_mask[*i])
                .map(|(_, m)| m.clone())
                .collect()
        };

        // 2. backend 端覆盖（前缀裁剪不适用，改用覆盖式同步）
        self.backend
            .set_messages(kept.clone())
            .await
            .map_err(AgentError::from)?;

        // 3. state 端覆盖
        {
            let mut state = self.state.lock().await;
            state.messages = kept;
        }
        debug!(
            "trim_context_dropping: 删除 {} 条，剩余 {} 条",
            dropped,
            drop_mask.len() - dropped
        );
        Ok(dropped)
    }

    // ─── A1 §6.2：锚点回填机制 ─────────────────────────

    /// 把选中的组**折叠**为锚点对（A1 §6.2 第一段：占位）
    ///
    /// 与 [`Self::trim_context_dropping`]（直接删除）的区别：**折叠不扔内容**——
    /// 组内消息合成为「一对前后锚点 + 空容器位」，原文先外置（硬前提），
    /// 压缩文本由 [`Self::backfill_folds`] 后续填回。
    ///
    /// ## 硬前提（安全设计）
    ///
    /// 对每个候选组：先经 [`crate::raw_context::RawContextSink`] 外置合并材料，
    /// **只有外置成功（`Some`）才替换为折叠形**；外置被拒（超闸门 / 未注入）
    /// 时**该组保留原样**——宁可超线，也不制造「上下文里没了、存储里也没有」
    /// 的不可恢复丢失。
    ///
    /// ## 配对安全
    ///
    /// 组 = [`crate::retention`] 的工具交换组（`assistant(tool_calls)` + 其
    /// 结果集）：折叠以**组为原子单位**，组内全部消息合并为一条折叠形并清空
    /// `tool_calls` / `tool_call_id`——工具配对关系在折叠形内部整体消化，
    /// 不产生新的悬空 `tool_call_id`。
    ///
    /// ## 不二次折叠
    ///
    /// 已是折叠形的消息不再参与折叠（其原文已在外置层，再次折叠只会套娃）；
    /// 该组按「跳过」处理。
    ///
    /// 无外置器注入（`raw_context_enabled == false`）时不应调用本方法——
    /// 调用方（`enforce_context_budget`）会退回旧的删除路径。
    pub async fn fold_context(
        &self,
        groups: &[Vec<usize>],
    ) -> Result<crate::anchor::FoldOutcome, AgentError> {
        use crate::anchor as mark;
        let mut outcome = mark::FoldOutcome::default();
        if groups.is_empty() {
            return Ok(outcome);
        }

        // 快照（一次持锁取齐；后续在副本上计算，最后统一写回——与 trim 同款模式）
        let snapshot: Vec<OrchestratorMessage> = self.state.lock().await.messages.clone();
        let policy = mark::FoldPolicy::default();

        // 组首下标 → 折叠形；covered = 被折叠组的全部成员下标
        let mut replacements: std::collections::HashMap<usize, OrchestratorMessage> =
            std::collections::HashMap::new();
        let mut covered: std::collections::HashSet<usize> = std::collections::HashSet::new();

        for group in groups {
            let members: Vec<OrchestratorMessage> = group
                .iter()
                .filter_map(|&i| snapshot.get(i).cloned())
                .collect();
            if members.is_empty() {
                continue;
            }
            // 不二次折叠：组内任一条已是折叠形 → 整组跳过
            if members.iter().any(mark::is_folded) {
                outcome.skipped_embedded += 1;
                continue;
            }

            // ★ 硬前提：原文先安全外置（失败/被拒 → 该组保留原样）
            let archive = mark::render_archive_content(&members);
            let Some(raw_ref) = (self.raw_context_sink)(&archive) else {
                outcome.skipped_denied += 1;
                continue;
            };

            let orig_tokens: usize = members
                .iter()
                .map(|m| {
                    (self.token_estimator)(&m.content) + super::MESSAGE_STRUCTURE_OVERHEAD_TOKENS
                })
                .sum();
            let meta = mark::FoldMeta {
                state: mark::FoldState::Placeholder,
                raw: raw_ref.content_hash.clone(),
                orig_bytes: raw_ref.byte_len,
                orig_count: members.len(),
                orig_tokens,
            };
            let folded = mark::make_folded_message(mark::fold_role_of(&members), &meta);
            let folded_tokens = (self.token_estimator)(&folded.content)
                + super::MESSAGE_STRUCTURE_OVERHEAD_TOKENS;

            outcome.saved_tokens += orig_tokens.saturating_sub(folded_tokens);
            outcome.folded_messages += members.len();
            outcome.folded_groups += 1;
            let condensed = mark::condense(&archive, policy.head_chars, policy.tail_chars);
            // 阶段 3 · D4：原文材料随 fills 一并带出（LLM 摘要生成取用；与 fills 同序同长）
            outcome
                .materials
                .push((raw_ref.content_hash.clone(), archive));
            outcome.fills.push((raw_ref.content_hash, condensed));

            replacements.insert(group[0], folded);
            covered.extend(group.iter().copied());
        }

        if outcome.folded_groups == 0 {
            debug!(
                "fold_context: 无可折叠组（外置拒绝 {} / 已折叠 {}）",
                outcome.skipped_denied, outcome.skipped_embedded
            );
            return Ok(outcome);
        }

        // 组装新列表：组首 → 折叠形（占位态）；组内其余 → 移除；组外 → 原样
        let mut kept: Vec<OrchestratorMessage> = Vec::with_capacity(snapshot.len());
        for (i, m) in snapshot.iter().enumerate() {
            if let Some(folded) = replacements.get(&i) {
                kept.push(folded.clone());
                continue;
            }
            if covered.contains(&i) {
                continue;
            }
            kept.push(m.clone());
        }

        // backend 覆盖 + state 覆盖（与 trim_context_dropping 同源，避免状态漂移）
        self.backend
            .set_messages(kept.clone())
            .await
            .map_err(AgentError::from)?;
        {
            let mut state = self.state.lock().await;
            state.messages = kept;
        }
        debug!(
            "fold_context: 折叠 {} 组（{} 条 → {} 锚点），估计释放 {} token",
            outcome.folded_groups, outcome.folded_messages, outcome.folded_groups, outcome.saved_tokens
        );
        Ok(outcome)
    }

    /// 把压缩文本**填回**锚点之间（A1 §6.2 第二段：空容器位 → 已回填）
    ///
    /// `fills` = `(raw 坐标, 压缩文本)` 对（通常来自 [`Self::fold_context`] 的产出，
    /// 也可由外部压缩器异步生成后传入）。对每条**占位态**折叠形：
    /// 按坐标找到压缩文本 → 渲染为已回填形态。
    ///
    /// 找不到对应压缩文本的折叠形**保持占位**（优雅降级：坐标仍在，可回源）。
    /// 返回实际填回的条数。
    pub async fn backfill_folds(&self, fills: &[(String, String)]) -> Result<usize, AgentError> {
        use crate::anchor as mark;
        if fills.is_empty() {
            return Ok(0);
        }

        // 1. 锁内计算新列表（照 trim_context_dropping 的三段式：算 → backend → state）
        let (kept, filled) = {
            let state = self.state.lock().await;
            let mut kept = state.messages.clone();
            let mut filled = 0usize;
            for msg in kept.iter_mut() {
                let Some(mut meta) = mark::fold_meta_of(msg) else {
                    continue;
                };
                if meta.state != mark::FoldState::Placeholder {
                    continue;
                }
                let Some((_, condensed)) = fills.iter().find(|(h, _)| h == &meta.raw) else {
                    continue;
                };
                msg.content = mark::render_filled(&meta, condensed);
                meta.state = mark::FoldState::Filled;
                mark::set_fold_meta(msg, &meta);
                filled += 1;
            }
            (kept, filled)
        };
        if filled == 0 {
            return Ok(0);
        }

        // 2. backend 端覆盖（消息内容已变）
        self.backend
            .set_messages(kept.clone())
            .await
            .map_err(AgentError::from)?;
        // 3. state 端覆盖
        {
            let mut state = self.state.lock().await;
            state.messages = kept;
        }
        debug!("backfill_folds: 已填回 {} 条折叠形", filled);
        Ok(filled)
    }

    /// 获取 pi-ai agent 内部 messages — 对应前端 `IAgentBackend.getRuntimeMessages()`
    ///
    /// 用于长任务 checkpoint 持久化，区别于 `get_messages()`（返回值类型相同，但语义上为 runtime）。
    pub async fn get_runtime_messages(&self) -> Vec<OrchestratorMessage> {
        self.state.lock().await.messages.clone()
    }

    /// 写回 pi-ai agent 内部 messages — 对应前端 `IAgentBackend.setRuntimeMessages(messages)`
    ///
    /// 用于断点恢复：将 checkpoint 持久化的 messages 写回 state.messages。
    /// 同时同步到 backend，保证两边一致。
    pub async fn set_runtime_messages(
        &self,
        messages: Vec<OrchestratorMessage>,
    ) -> Result<(), AgentError> {
        // 1. 同步到 backend
        self.backend
            .set_messages(messages.clone())
            .await
            .map_err(AgentError::from)?;

        // 2. 写回 state
        let mut state = self.state.lock().await;
        state.messages = messages;
        debug!("set_runtime_messages: 已写回 {} 条消息", state.messages.len());
        Ok(())
    }

    /// 重置实例状态（委派超时后调用），详细见 docs/details/注释/agent-runtime/agent.md
    pub async fn reset_after_timeout(&self) {
        self.is_streaming.store(false, Ordering::SeqCst);
        {
            let mut state = self.state.lock().await;
            if let Some(last) = state.messages.last() {
                if last.role == MessageRole::Assistant && !last.tool_calls.is_empty() {
                    state.messages.pop();
                }
            }
        }
    }

    /// 获取状态快照 — 对应前端 `IAgentBackend.state`
    ///
    /// 返回 `AgentStateSnapshot`，包含序列化友好的只读视图。
    pub async fn get_state_snapshot(&self) -> AgentStateSnapshot {
        let state = self.state.lock().await;
        let model = self.backend.current_model().await;
        let thinking_level = self
            .config_snapshot()
            .thinking_level;
        AgentStateSnapshot {
            current_iteration: state.current_iteration,
            aborted: state.aborted,
            paused: state.paused,
            is_streaming: self.is_streaming(),
            messages: state.messages.clone(),
            model,
            thinking_level,
            plan: state.plan.clone(),
        }
    }

    /// 热切换模型，详细见 docs/details/注释/agent-runtime/agent.md
    pub async fn update_model(
        &self,
        provider: String,
        model_id: String,
        base_url: Option<String>,
        api_key: Option<String>,
        temperature: Option<f32>,
        max_tokens: Option<u32>,
        top_p: Option<f32>,
        top_k: Option<u32>,
        thinking_mode: Option<bool>,
        total_steps: Option<u32>,
    ) -> Result<(), AgentError> {
        // 1. 调用 backend.update_provider 热切换
        // clone provider/model_id 供下面日志使用，避免 move 后借用报错
        self.backend
            .update_provider(provider.clone(), model_id.clone(), api_key, base_url)
            .await
            .map_err(AgentError::from)?;

        // 2. 同步更新 config 的 temperature/max_tokens/top_p/top_k/thinking_mode/total_steps（若传入）
        if temperature.is_some()
            || max_tokens.is_some()
            || top_p.is_some()
            || top_k.is_some()
            || thinking_mode.is_some()
            || total_steps.is_some()
        {
            if let Ok(mut guard) = self.config.write() {
                if let Some(t) = temperature {
                    guard.temperature = Some(t);
                }
                if let Some(m) = max_tokens {
                    guard.max_tokens = Some(m);
                }
                if let Some(p) = top_p {
                    guard.top_p = Some(p);
                }
                if let Some(k) = top_k {
                    guard.top_k = Some(k);
                }
                if let Some(tm) = thinking_mode {
                    guard.thinking_mode = Some(tm);
                }
                // 总步骤预算：clamp 到 1~500（与 AgentLoopConfig 范围约定一致）
                if let Some(s) = total_steps {
                    guard.total_steps = s.clamp(1, 500);
                }
            }
        }

        debug!("update_model: 已切换至 provider={}, model={}", provider, model_id);
        Ok(())
    }

    /// 获取当前 Provider 配置（供 `get_provider_config` 命令回显）
    ///
    /// 由 backend 实现决定是否返回（`GenaiBackend` 返回真实配置）。
    pub async fn current_provider_config(&self) -> Option<ProviderConfig> {
        self.backend.current_provider_config().await
    }

    /// 整体替换 Provider 配置（支持跨模式切换，不清空消息历史）
    ///
    /// 对应 `set_provider_config` 命令，接收完整 [`ProviderConfig`]
    /// （cloud/local/custom 三种模式），由 backend 实现覆盖。
    pub async fn set_provider_config(&self, config: ProviderConfig) -> Result<(), AgentError> {
        self.backend
            .set_provider_config(config)
            .await
            .map_err(AgentError::from)
    }

    /// 注入备用 API Key 池（A2 多 Key 降级）
    ///
    /// 主 key 由 [`Self::set_provider_config`] 写入；`keys` 为备用 key 池，
    /// 主 key 请求命中可重试错误（认证/限流/网络）时逐把降级重试。
    pub async fn set_api_key_pool(&self, keys: Vec<String>) -> Result<(), AgentError> {
        self.backend
            .set_api_key_pool(keys)
            .await
            .map_err(AgentError::from)
    }

    /// 读取备用 API Key 池（A2；供会话派生面复制——如分叉子会话继承父配置）
    pub async fn current_api_key_pool(&self) -> Vec<String> {
        self.backend.api_key_pool().await
    }

    /// S4-b：写入会话级授权（**仅会话内存活**；只服务 alwaysAsk gate——ZD2-3）。
    /// 返回写入后的条目总数。空工具名 / 空内容模式被忽略（见 `SessionPermissionGrants::grant`）。
    pub fn grant_session_permission(
        &self,
        entries: Vec<crate::permission_machine::SessionGrant>,
    ) -> usize {
        let mut grants = self.session_grants.lock().unwrap_or_else(|e| e.into_inner());
        for entry in entries {
            grants.grant(entry.tool_name, entry.content, entry.once);
        }
        grants.len()
    }

    /// S4-b：消费会话级授权（`once` 命中即移除）；返回是否命中。
    pub fn consume_session_grant(&self, tool_name: &str, subject: Option<&str>) -> bool {
        self.session_grants
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .consume(tool_name, subject)
    }

    /// S4-b：会话级授权当前条目数（可观测 / 测试用）
    pub fn session_grant_count(&self) -> usize {
        self.session_grants.lock().unwrap_or_else(|e| e.into_inner()).len()
    }
}
