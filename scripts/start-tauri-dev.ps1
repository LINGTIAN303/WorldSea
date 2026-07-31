# 启动 Tauri dev 应用，开启 WebView2 CDP 端口 9222 用于自动化测试
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
Set-Location "d:\本地化AI\DeepSeek_Home\worldsmith"
npm run tauri:dev
