from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    node_script = script_dir / "get_qzone_history_browser.js"
    if not node_script.exists():
        print(f"Missing browser script: {node_script}", file=sys.stderr)
        return 1

    command = ["node", str(node_script), *sys.argv[1:]]
    completed = subprocess.run(command, cwd=script_dir)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
