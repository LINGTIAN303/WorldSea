"""阶段 1.5 验收脚本：清除所有可能的代理后执行 cargo check"""
import os
import subprocess
import sys

# 清除所有可能的代理环境变量
for k in list(os.environ.keys()):
    if "proxy" in k.lower():
        del os.environ[k]

# 显式设置无代理
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"
os.environ["CARGO_NET_OFFLINE"] = "false"  # 确保不强制离线

# 切换工作目录
work_dir = r"d:\本地化AI\DeepSeek_Home\worldsmith\src-tauri"
os.chdir(work_dir)

# 执行 cargo check
cmd = ["cargo", "check", "--features", "agent-runtime/llm-genai"]
print(f"$ cd {work_dir}")
print(f"$ {' '.join(cmd)}")
print(f"NO_PROXY={os.environ.get('NO_PROXY')}")
print("-" * 60)

result = subprocess.run(
    cmd,
    cwd=work_dir,
    capture_output=True,
    text=True,
    encoding="utf-8",
    errors="replace",
)

if result.stdout:
    print(result.stdout[-6000:])
if result.stderr:
    print(result.stderr[-6000:])

print("-" * 60)
print(f"exit code: {result.returncode}")
sys.exit(result.returncode)
