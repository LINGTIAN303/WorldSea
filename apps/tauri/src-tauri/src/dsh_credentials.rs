// 凭据环境取向（从 dsh_shell.rs 拆出）：**库优先 + env 兜底**。dsh 的凭据分层是
// 「继承环境（**最高优先**）> `$DSH_HOME/.credentials.yaml`（页面「设置 → 模型」写入的库）> 项目 `.env` > home `.env`」
//（见 dsh `credentials-local` 头注），所以只要环境里有 Key 就会永久盖住界面配置。壳在 spawn 前判一次库：
// - 库里已有该凭据（`refs:` 段）→ 剥掉继承的环境变量，以界面配置为准；库里没有 → 保留继承的环境变量作零配置兜底。
// 反证/逃生口：`WORLDSEA_KEEP_ENV_KEYS=1` 强制保留继承（复现「界面改 Key 不生效」）。

use std::path::Path;
use std::process::Command;

/// 归壳管的凭据环境变量（逐条可审计；将来接入别的 provider 时在此加行）。
const CREDENTIAL_ENV_NAMES: [&str; 1] = ["DEEPSEEK_API_KEY"];

/// spawn 前应用凭据取向：命中判定则 `env_remove`，并落下可取证的一行日志。
pub(crate) fn apply_credential_env(command: &mut Command, home: &Path) {
    if std::env::var_os("WORLDSEA_KEEP_ENV_KEYS").is_some() {
        println!("[DSH-SHELL] 凭据环境剥离已按 WORLDSEA_KEEP_ENV_KEYS 关闭（反证模式：继承的 Key 会盖住界面配置）");
        return;
    }
    for name in CREDENTIAL_ENV_NAMES {
        if std::env::var_os(name).is_none() {
            continue;
        }
        if credential_store_has(home, name) {
            command.env_remove(name);
            println!("[DSH-SHELL] 库（.credentials.yaml）已有 {name}：剥离继承的环境变量，以界面配置为准");
        } else {
            println!("[DSH-SHELL] 库中无 {name}：保留继承的环境变量作兜底（在界面里配置后自动改以库为准）");
        }
    }
}

/// 凭据库里是否已存有某凭据——读 `$DSH_HOME/.credentials.yaml` 的 **`refs:` 段**。
/// 该文档是带版本的结构（`version` / `refs` / `records`）：`refs` 按环境变量名存密钥值（本函数关心的），
/// `records` 按 `<owner>/<id>` 存插件凭据（与 API Key 无关）——见 dsh `credentials-local` README。
/// 不做完整 YAML 解析：只跟踪 `refs:` 段内更深缩进的行；段外出现不更深缩进的行即判定段已结束。
fn credential_store_has(home: &Path, name: &str) -> bool {
    let Ok(text) = std::fs::read_to_string(home.join(".credentials.yaml")) else {
        return false;
    };
    let mut refs_indent: Option<usize> = None;
    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let indent = line.len() - trimmed.len();
        match refs_indent {
            None => {
                if trimmed == "refs:" {
                    refs_indent = Some(indent);
                }
            }
            Some(level) => {
                if indent <= level {
                    return false; // refs 段已结束
                }
                let candidate = trimmed.strip_prefix('"').unwrap_or(trimmed);
                if let Some(rest) = candidate.strip_prefix(name) {
                    let rest = rest.trim_start().strip_prefix('"').unwrap_or(rest);
                    if rest.trim_start().starts_with(':') {
                        return true;
                    }
                }
            }
        }
    }
    false
}

#[cfg(test)]
#[path = "dsh_credentials_tests.rs"]
mod tests;
