use async_trait::async_trait;
use tracing::{debug, info};

use agent_kernel::backend::{NodeBackendAccessor, PromptCallOptions};

use super::blackboard::SharedBlackboard;
use super::error::MultiAgentError;

// ─── 综合策略 trait ────────────────────────────────────────────

/// 综合策略 trait — 如何将多个 Agent 的输出合并为最终结果
///
/// 默认实现：`LlmSynthesisStrategy`（通过 LLM 综合所有 Agent 输出）
/// 可注入自定义实现：拼接、投票、加权等。
#[async_trait]
pub trait SynthesisStrategy: Send + Sync {
    /// 综合 Agent 输出与黑板状态，生成最终结果
    ///
    /// # 参数
    /// - `task`：原始任务
    /// - `blackboard`：共享黑板（含 agent_outputs 等）
    /// - `backend`：LLM 后端访问器
    async fn synthesize(
        &self,
        task: &str,
        blackboard: &SharedBlackboard,
        backend: &dyn NodeBackendAccessor,
    ) -> Result<String, MultiAgentError>;
}

/// 综合提示词模板
#[derive(Debug, Clone)]
pub struct SynthesisPromptTemplate {
    pub system: String,
    pub user_template: String,
}

impl Default for SynthesisPromptTemplate {
    fn default() -> Self {
        Self {
            system: "你是一个综合者，负责将多个 Agent 的输出整合为最终答案。\
                    请综合所有 Agent 的输出，去除冗余，保留有价值的信息，生成连贯的最终答案。".into(),
            user_template: r#"原始任务：{task}

各 Agent 输出：
{outputs}

请综合上述输出，生成最终的完整答案："#
                .into(),
        }
    }
}

/// LLM 综合策略（默认）
pub struct LlmSynthesisStrategy {
    pub prompt_template: SynthesisPromptTemplate,
}

impl Default for LlmSynthesisStrategy {
    fn default() -> Self {
        Self {
            prompt_template: SynthesisPromptTemplate::default(),
        }
    }
}

impl LlmSynthesisStrategy {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_template(template: SynthesisPromptTemplate) -> Self {
        Self {
            prompt_template: template,
        }
    }

    /// 格式化各 Agent 输出
    fn format_outputs(blackboard: &SharedBlackboard) -> String {
        blackboard
            .agent_outputs
            .iter()
            .map(|(agent_id, outputs)| {
                let combined = outputs.join("\n---\n");
                format!("[Agent {}]:\n{}", agent_id, combined)
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    /// 渲染用户提示词
    fn render_user_prompt(&self, task: &str, blackboard: &SharedBlackboard) -> String {
        self.prompt_template
            .user_template
            .replace("{task}", task)
            .replace("{outputs}", &Self::format_outputs(blackboard))
    }
}

#[async_trait]
impl SynthesisStrategy for LlmSynthesisStrategy {
    async fn synthesize(
        &self,
        task: &str,
        blackboard: &SharedBlackboard,
        backend: &dyn NodeBackendAccessor,
    ) -> Result<String, MultiAgentError> {
        // 如果黑板已有 final_result，直接返回
        if let Some(result) = &blackboard.final_result {
            return Ok(result.clone());
        }

        // 如果只有一个 Agent 输出，直接返回（无需综合）
        if blackboard.agent_outputs.len() == 1 {
            let outputs = blackboard.agent_outputs.values().next().unwrap();
            if outputs.len() == 1 {
                return Ok(outputs[0].clone());
            }
        }

        // 调用 LLM 综合
        let options = PromptCallOptions {
            system_prompt_override: Some(self.prompt_template.system.clone()),
            tools_override: Some(Vec::new()),
            ..Default::default()
        };

        let user_prompt = self.render_user_prompt(task, blackboard);
        debug!("Multi-Agent: 调用 LLM 综合，task 长度: {}", task.len());

        let response = backend.prompt(user_prompt, Some(options)).await?;
        info!(
            "Multi-Agent: LLM 综合完成，输出长度: {}",
            response.text.len()
        );

        Ok(response.text)
    }
}

// ─── 目标检查策略 trait ────────────────────────────────────────────

/// 目标检查策略 trait — 判断协作是否已达成目标
///
/// 默认实现：`LlmGoalCheckStrategy`（通过 LLM 判断）
/// 可注入自定义实现：基于关键词、基于评分等。
#[async_trait]
pub trait GoalCheckStrategyMA: Send + Sync {
    /// 检查协作是否已达成目标
    ///
    /// # 参数
    /// - `task`：原始任务
    /// - `blackboard`：共享黑板
    /// - `backend`：LLM 后端访问器
    async fn check_goal(
        &self,
        task: &str,
        blackboard: &SharedBlackboard,
        backend: &dyn NodeBackendAccessor,
    ) -> Result<bool, MultiAgentError>;
}

/// 目标检查提示词模板
#[derive(Debug, Clone)]
pub struct GoalCheckMAPromptTemplate {
    pub system: String,
    pub user_template: String,
}

impl Default for GoalCheckMAPromptTemplate {
    fn default() -> Self {
        Self {
            system: "你是一个目标检查者，负责判断多 Agent 协作是否已达成原始任务目标。\
                    请基于各 Agent 的输出，判断任务是否已完成。\
                    必须输出合法 JSON 格式：{\"goal_reached\": true/false, \"reasoning\": \"...\"}".into(),
            user_template: r#"原始任务：{task}

各 Agent 输出：
{outputs}

请判断任务是否已完成（仅输出 JSON）："#
                .into(),
        }
    }
}

/// LLM 目标检查策略（默认）
pub struct LlmGoalCheckStrategyMA {
    pub prompt_template: GoalCheckMAPromptTemplate,
}

impl Default for LlmGoalCheckStrategyMA {
    fn default() -> Self {
        Self {
            prompt_template: GoalCheckMAPromptTemplate::default(),
        }
    }
}

impl LlmGoalCheckStrategyMA {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_template(template: GoalCheckMAPromptTemplate) -> Self {
        Self {
            prompt_template: template,
        }
    }

    fn format_outputs(blackboard: &SharedBlackboard) -> String {
        blackboard
            .agent_outputs
            .iter()
            .map(|(agent_id, outputs)| {
                let combined = outputs.join("\n---\n");
                format!("[Agent {}]:\n{}", agent_id, combined)
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    fn render_user_prompt(&self, task: &str, blackboard: &SharedBlackboard) -> String {
        self.prompt_template
            .user_template
            .replace("{task}", task)
            .replace("{outputs}", &Self::format_outputs(blackboard))
    }

    fn parse_response(text: &str) -> Result<bool, MultiAgentError> {
        let trimmed = text.trim();
        let json_str = trimmed
            .strip_prefix("```json")
            .or_else(|| trimmed.strip_prefix("```"))
            .and_then(|s| s.strip_suffix("```"))
            .map(|s| s.trim())
            .unwrap_or(trimmed);

        #[derive(serde::Deserialize)]
        struct GoalCheckResponse {
            goal_reached: bool,
            #[serde(default)]
            #[allow(dead_code)]
            reasoning: Option<String>,
        }

        let result: GoalCheckResponse = serde_json::from_str(json_str).map_err(|e| {
            MultiAgentError::Parse(format!("JSON 解析失败: {} (input: {})", e, json_str))
        })?;

        Ok(result.goal_reached)
    }
}

#[async_trait]
impl GoalCheckStrategyMA for LlmGoalCheckStrategyMA {
    async fn check_goal(
        &self,
        task: &str,
        blackboard: &SharedBlackboard,
        backend: &dyn NodeBackendAccessor,
    ) -> Result<bool, MultiAgentError> {
        // 如果黑板已有 final_result，视为达成
        if blackboard.final_result.is_some() {
            return Ok(true);
        }

        // 如果无 Agent 输出，未达成
        if blackboard.agent_outputs.is_empty() {
            return Ok(false);
        }

        let options = PromptCallOptions {
            system_prompt_override: Some(self.prompt_template.system.clone()),
            tools_override: Some(Vec::new()),
            ..Default::default()
        };

        let user_prompt = self.render_user_prompt(task, blackboard);
        let response = backend.prompt(user_prompt, Some(options)).await?;

        Self::parse_response(&response.text)
    }
}
