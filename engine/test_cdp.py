#!/usr/bin/env python3
import asyncio
import urllib.request
import json
import sys

def check_cdp(url="http://localhost:9222/json/version"):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "AutoApply"})
        with urllib.request.urlopen(req, timeout=2) as response:
            data = json.loads(response.read().decode())
            print(f"[CDP OK] Connected to Chrome DevTools Protocol:")
            print(f"  Browser: {data.get('Browser')}")
            print(f"  Protocol: {data.get('Protocol-Version')}")
            print(f"  WebSocket: {data.get('webSocketDebuggerUrl')}")
            return True
    except Exception as e:
        print(f"[CDP Inactive] Could not connect to {url}: {e}")
        print("Tip: Run ./scripts/launch-chrome-cdp.sh to launch Chrome with CDP enabled on port 9222.")
        return False

if __name__ == "__main__":
    success = check_cdp()
    sys.exit(0 if success else 1)
