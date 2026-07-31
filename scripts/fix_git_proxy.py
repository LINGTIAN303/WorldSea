"""为 rsproxy.cn 和 rsproxy.cn 的 IP 添加无代理配置到 .gitconfig"""
import subprocess

git_config = r"""
[http "https://rsproxy.cn/"]
        proxy =
[http "https://mirrors.ustc.edu.cn/"]
        proxy =
"""

# 追加到全局 gitconfig
result = subprocess.run(
    ["git", "config", "--global", "--add", 'http."https://rsproxy.cn/".proxy', ""],
    capture_output=True, text=True
)
print("add rsproxy:", result.returncode, result.stderr)

result = subprocess.run(
    ["git", "config", "--global", "--add", 'http."https://mirrors.ustc.edu.cn/".proxy', ""],
    capture_output=True, text=True
)
print("add ustc:", result.returncode, result.stderr)

# 验证
result = subprocess.run(
    ["git", "config", "--global", "--get-regexp", "http\\..*\\.proxy"],
    capture_output=True, text=True
)
print("---")
print(result.stdout)
