use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewAnimationConfig {
    #[serde(default = "default_duration")]
    pub duration_ms: u32,
    #[serde(default)]
    pub easing: EasingType,
    #[serde(default)]
    pub stagger_ms: u32,
    #[serde(default)]
    pub enter_effect: EnterEffect,
    #[serde(default)]
    pub exit_effect: ExitEffect,
}

fn default_duration() -> u32 { 300 }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum EasingType {
    #[default]
    Ease,
    Linear,
    EaseIn,
    EaseOut,
    EaseInOut,
    Spring,
    Bounce,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum EnterEffect {
    #[default]
    FadeIn,
    SlideUp,
    SlideRight,
    ScaleUp,
    FlipIn,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ExitEffect {
    #[default]
    FadeOut,
    SlideDown,
    SlideRight,
    ScaleDown,
    FlipOut,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldAnimationConfig {
    pub on_change: Option<ChangeAnimation>,
    pub on_state: Option<StateAnimation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeAnimation {
    pub effect: String,
    #[serde(default = "default_duration")]
    pub duration_ms: u32,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateAnimation {
    pub condition: String,
    pub effect: String,
    #[serde(default)]
    pub persistent: bool,
}
