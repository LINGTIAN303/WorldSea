import subprocess
import psutil

# Check process 4344
try:
    p = psutil.Process(4344)
    print(f"PID 4344:")
    print(f"  name: {p.name()}")
    print(f"  exe: {p.exe()}")
    print(f"  cmdline: {p.cmdline()}")
    print(f"  cwd: {p.cwd()}")
    print(f"  parent: {p.parent().name() if p.parent() else None}")
    print(f"  parent PID: {p.ppid()}")
except Exception as e:
    print(f"psutil error: {e}")

print("---")
# List all webview-related processes
for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'ppid']):
    name = proc.info['name'] or ''
    if 'worldsmith' in name.lower() or 'msedgewebview2' in name.lower() or 'tauri' in name.lower():
        print(f"PID={proc.info['pid']} PPID={proc.info['ppid']} Name={name}")
        try:
            print(f"  cmdline: {proc.info['cmdline']}")
        except:
            pass
