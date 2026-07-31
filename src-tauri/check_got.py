import subprocess
import os

env = os.environ.copy()
env['NO_PROXY'] = '*'
env['HTTP_PROXY'] = ''
env['HTTPS_PROXY'] = ''

result = subprocess.run(
    ['cargo', 'check', '--message-format=short'],
    cwd=r'd:\本地化AI\DeepSeek_Home\worldsmith\src-tauri',
    env=env,
    capture_output=True,
    text=True,
    encoding='utf-8',
    errors='replace',
)

# 打印最后 100 行
out_lines = result.stdout.splitlines()
err_lines = result.stderr.splitlines()
all_lines = out_lines + err_lines
print(f"=== exit code: {result.returncode} ===")
print(f"=== total lines: {len(all_lines)} ===")
for line in all_lines[-100:]:
    print(line)
