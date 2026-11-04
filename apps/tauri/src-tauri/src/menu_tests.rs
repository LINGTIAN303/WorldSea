// 菜单的动态 id 解析（「外部插件」子菜单项）——纯函数，不碰 Tauri。
// 菜单本身要真实窗口才能建，属真机走查范围；这里只锁住「点了哪个 id 会处置哪个包」。

use super::*;

#[test]
fn plugin_action_ids_round_trip() {
    let (action, name) = parse_plugin_action("worldsea.plugin.disable.dsh-whale-widget")
        .expect("应解析出停用");
    assert_eq!(action, crate::dsh_plugin_control::Remediation::Disable);
    assert_eq!(name, "dsh-whale-widget");

    let (action, name) = parse_plugin_action("worldsea.plugin.remove.dsh-plugin-wallpaper-engine")
        .expect("应解析出卸载");
    assert_eq!(action, crate::dsh_plugin_control::Remediation::Remove);
    assert_eq!(name, "dsh-plugin-wallpaper-engine");
}

#[test]
fn scoped_package_names_are_kept_whole() {
    // 包名自带点与斜杠（第三方 scope）：只按第一个点切动词，其余整体是包名。
    let (_, name) = parse_plugin_action("worldsea.plugin.disable.@montersy123/dsh-skill-market")
        .expect("应解析出 scope 包名");
    assert_eq!(name, "@montersy123/dsh-skill-market");

    let (_, name) = parse_plugin_action("worldsea.plugin.remove.@linxin666/dsh-client-ui-skill-explorer")
        .expect("应解析出 scope 包名");
    assert_eq!(name, "@linxin666/dsh-client-ui-skill-explorer");
}

#[test]
fn the_verb_position_is_anchored_to_the_first_segment() {
    // 回归锁：曾经用 `rsplit_once` 也「碰巧」通过了上面那条（scope 包名里最后一段
    // 正好不是动词），但那是巧合。构造一个包名本身以动词结尾的 id 就能分辨：
    // 正确实现按第一个点切 → 动词 disable、包名 "a/b.disable"；
    // 错误实现（从右切）→ 动词变成 "disable"，包名 "a/b"，或直接解析失败。
    let (action, name) = parse_plugin_action("worldsea.plugin.disable.a/b.disable")
        .expect("应解析出停用");
    assert_eq!(action, crate::dsh_plugin_control::Remediation::Disable);
    assert_eq!(name, "a/b.disable", "包名须整体保留，不能从右侧再切一次");
}

#[test]
fn unknown_or_malformed_ids_are_ignored() {
    // 未知动作、缺包名、缺前缀：一律不认——宁可菜单项没反应，也不误处置某个包。
    assert!(parse_plugin_action("worldsea.plugin.purge.some-pkg").is_none(), "未知动词不得解析");
    assert!(parse_plugin_action("worldsea.plugin.disable.").is_none(), "缺包名不得解析");
    assert!(parse_plugin_action("worldsea.plugin.disable").is_none(), "缺分隔点不得解析");
    assert!(parse_plugin_action("worldsea.reload").is_none(), "非本族 id 不得解析");
    assert!(parse_plugin_action("").is_none(), "空 id 不得解析");
}
