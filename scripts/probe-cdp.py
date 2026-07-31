import socket
import sys

# Test if port 9222 is listening and on what process
import subprocess

# 1. Check listening port
result = subprocess.run(['netstat', '-ano'], capture_output=True, text=True, encoding='gbk', errors='ignore')
for line in result.stdout.split('\n'):
    if ':9222' in line:
        print("FOUND:", line.strip())

print("---")

# 2. Test raw TCP connection
try:
    s = socket.create_connection(('localhost', 9222), timeout=3)
    print("TCP connect to 9222: OK")
    # Send HTTP request
    s.sendall(b"GET /json HTTP/1.1\r\nHost: localhost:9222\r\n\r\n")
    data = s.recv(2048)
    print("Response (first 500 bytes):")
    print(data[:500].decode('utf-8', errors='replace'))
    s.close()
except Exception as e:
    print(f"TCP connect failed: {e}")
