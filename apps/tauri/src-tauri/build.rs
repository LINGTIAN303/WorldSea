fn main() {
    // tauri-build 不跟踪图标文件变更（已验证 2.6.3 源码），不补此行则改图标后未重编译的
    // 构建产物会继续内嵌旧图标（2026-10-26 Logo 圆角批的 debug 产物即踩此坑）
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon-dark.png");
    println!("cargo:rerun-if-changed=icons/icon-light.png");
    tauri_build::build()
}
