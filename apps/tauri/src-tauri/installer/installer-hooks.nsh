; 安装后解压随包 Agent 运行时（dsh-runtime.zip 由 bundle.resources 落到 $INSTDIR）。
; 解压引擎 = 系统 tar.exe（Windows 10 1803+ 自带 bsdtar），与单文件安装器同一口径。
; 中文字面量用 ${U+XXXX} 转义：makensis 默认按 ACP 读脚本，UTF-8 无 BOM 的直写中文会编译失败。
!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "${U+90E8}${U+7F72} Agent ${U+8FD0}${U+884C}${U+65F6}..."
  RMDir /r "$INSTDIR\dsh-runtime"
  nsExec::ExecToLog '"$SYSDIR\tar.exe" -xf "$INSTDIR\dsh-runtime.zip" -C "$INSTDIR"'
  Pop $0
  Delete "$INSTDIR\dsh-runtime.zip"
  StrCmp $0 "0" worldsea_runtime_check worldsea_runtime_fail
  worldsea_runtime_check:
    IfFileExists "$INSTDIR\dsh-runtime\node\node.exe" 0 worldsea_runtime_fail
    IfFileExists "$INSTDIR\dsh-runtime\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js" 0 worldsea_runtime_fail
    Goto worldsea_runtime_ok
  worldsea_runtime_fail:
    MessageBox MB_ICONSTOP "Agent ${U+8FD0}${U+884C}${U+65F6}${U+89E3}${U+538B}${U+5931}${U+8D25}${U+FF08}tar ${U+9000}${U+51FA}${U+7801} $0${U+FF09}${U+3002}${U+8BF7}${U+786E}${U+8BA4}${U+7CFB}${U+7EDF}${U+4E3A} Windows 10 1803 ${U+6216}${U+66F4}${U+9AD8}${U+7248}${U+672C}${U+3002}"
  worldsea_runtime_ok:
!macroend

; 卸载前清掉解压产物（不在 NSIS 文件清单内，需显式删除）。
!macro NSIS_HOOK_PREUNINSTALL
  RMDir /r "$INSTDIR\dsh-runtime"
!macroend
