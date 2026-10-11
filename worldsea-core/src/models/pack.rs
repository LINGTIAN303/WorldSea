use serde::{Deserialize, Serialize};

/// 数据包格式版本号
pub const PACK_VERSION: u32 = 2;

/// 数据包清单，包含数据包的版本和导出元信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldSeaManifest {
  /// 数据包格式版本号
  pub version: u32,
  /// 数据包导出时间
  pub exported_at: String,
  /// 导出时使用的应用版本号
  #[serde(default)]
  pub app_version: Option<String>,
  /// 数据包描述信息
  #[serde(default)]
  pub description: Option<String>,
}

/// `WorldSea` 数据包，包含清单和序列化器数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldSeaPack {
  /// 数据包清单
  pub manifest: WorldSeaManifest,
  /// 各序列化器的导出数据
  pub serializers: serde_json::Value,
}

/// 导入报告单项，记录单个序列化器的导入结果统计
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReportItem {
  /// 序列化器标识
  pub serializer_id: String,
  /// 导入的总条目数
  pub total: u32,
  /// 新增的条目数
  pub added: u32,
  /// 跳过的条目数
  pub skipped: u32,
  /// 更新的条目数
  pub updated: u32,
  /// 导入过程中产生的错误信息列表
  pub errors: Vec<String>,
}

/// 导入报告，记录整个导入操作的执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
  /// 导入是否全部成功
  pub success: bool,
  /// 导入开始时间
  pub started_at: String,
  /// 导入完成时间
  pub completed_at: String,
  /// 各序列化器的导入结果明细
  pub items: Vec<ImportReportItem>,
  /// 使用的冲突解决策略
  pub strategy: String,
}
