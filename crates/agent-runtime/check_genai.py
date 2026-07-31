import subprocess
import os
import sys

# 清除代理环境变量
env = os.environ.copy()
env["HTTP_PROXY"] = ""
env["HTTPS_PROXY"] = ""
env["NO_PROXY"] = "*"
# 显式设置UTF-8输出
env["PYTHONIOENCODING"] = "utf-8"

# 工作目录
cwd = r"d:\本地化AI\DeepSeek_Home\worldsmith\crates\agent-runtime"

# 执行cargo check
result = subprocess.run(
    ["cargo", "check", "--features", "llm-genai"],
    cwd=cwd,
    env=env,
    capture_output=True,
    text=True,
    encoding="utf-8",
    errors="replace",
    timeout=600,
)

print("=== STDOUT ===")
print(result.stdout[:15000] if result.stdout else "(empty)")
print("\n=== STDERR ===")
print(result.stderr[:15000] if result.stderr else "(empty)")
print(f"\n=== EXIT CODE: {result.returncode} ===")
