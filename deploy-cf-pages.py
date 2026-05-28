# /// script
# requires-python = ">=3.12"
# dependencies = ["pyyaml"]
# ///
"""
Deploy jkk-rate-search to Cloudflare Pages.

AODP: level 1 | risk_class: local_mutation | domain: infrastructure
"""
import json
import os
import subprocess
import sys
from pathlib import Path

VAULT = Path(r"D:\00_ARH\.ARH-AGENT-ENV\_env-mgmt\env\state\keys_vault\_api-keys\arh-vault.json")
REPO_DIR = Path(r"D:\00_ARH\.ARH-Cloned-Github-Repo\jkk-rate-search")
PROJECT_NAME = "jkk-rate-search"


def vault_get(name: str) -> str | None:
    try:
        data = json.loads(VAULT.read_text(encoding="utf-8"))
        for entry in data.get("keys", []):
            if entry.get("name") == name:
                return entry.get("value")
    except Exception:
        pass
    return None


def find_wrangler() -> list[str]:
    """Resolve wrangler binary: npx, local node_modules, or system PATH."""
    # 1. Try npx (most reliable if npm/node are available)
    npx_check = subprocess.run(
        ["where", "npx"], capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if npx_check.returncode == 0 and npx_check.stdout.strip():
        return ["npx.cmd", "wrangler"]

    # 2. Try local node_modules from mission-hq (known ARH location)
    local_wrangler = Path(r"D:\00_ARH\01_homelab\01_github-repo\mission-hq\node_modules\.bin\wrangler.cmd")
    if local_wrangler.exists():
        return [str(local_wrangler)]

    # 3. Try wrangler directly in PATH
    wr_check = subprocess.run(
        ["where", "wrangler"], capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if wr_check.returncode == 0 and wr_check.stdout.strip():
        return ["wrangler"]

    return ["npx.cmd", "wrangler"]


def run_wrangler(args: list[str], env: dict, cwd: Path) -> subprocess.CompletedProcess:
    """Run wrangler with proper Windows encoding handling."""
    wrangler = find_wrangler()
    cmd = wrangler + args
    print(f"[deploy] Running: {' '.join(cmd)}")
    return subprocess.run(
        cmd,
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def fix_wrangler_jsonc() -> None:
    """Ensure wrangler.jsonc has pages_build_output_dir for Pages deploy."""
    wf = REPO_DIR / "wrangler.jsonc"
    if not wf.exists():
        print("[deploy] Creating wrangler.jsonc with Pages config...")
        wf.write_text(
            '{'
            '\n  "name": "jkk-rate-search",'
            '\n  "compatibility_date": "2026-05-27",'
            '\n  "pages_build_output_dir": "."'
            '\n}\n',
            encoding="utf-8",
        )
        return

    text = wf.read_text(encoding="utf-8")
    if "pages_build_output_dir" not in text:
        print("[deploy] Adding pages_build_output_dir to wrangler.jsonc...")
        # Remove assets.directory (Workers-style) and add pages_build_output_dir
        import re

        # Remove assets block if present
        text = re.sub(r',?\s*"assets":\s*\{[^}]*\}', '', text)
        # Add pages_build_output_dir before closing brace
        text = re.sub(
            r'(\}\s*)\Z',
            r'  "pages_build_output_dir": "."\n}',
            text,
        )
        wf.write_text(text, encoding="utf-8")


def main() -> int:
    env = os.environ.copy()

    # --- Auth: prefer API Token over Global API Key ---
    api_token = vault_get("cloudflare_api_token") or vault_get("cloudflare_api_token_backup")
    if api_token:
        print("[deploy] Using Cloudflare API Token for authentication.")
        env["CLOUDFLARE_API_TOKEN"] = api_token
        # Unset legacy vars to avoid conflicts
        env.pop("CLOUDFLARE_API_KEY", None)
        env.pop("CLOUDFLARE_EMAIL", None)
    else:
        global_key = vault_get("cloudflare_global_api_key")
        if global_key:
            print("[deploy] WARNING: Falling back to Global API Key (less reliable for Pages).")
            env["CLOUDFLARE_API_KEY"] = global_key
            env["CLOUDFLARE_EMAIL"] = "arh.homelab@gmail.com"
            env.pop("CLOUDFLARE_API_TOKEN", None)
        else:
            print("[deploy] ERROR: No Cloudflare credentials found in vault.")
            return 1

    fix_wrangler_jsonc()

    # --- Deploy ---
    # Use 'wrangler pages deploy . --project-name <name>'
    result = run_wrangler(
        ["pages", "deploy", ".", "--project-name", PROJECT_NAME],
        env,
        REPO_DIR,
    )

    print("--- STDOUT ---")
    print(result.stdout)
    if result.stderr:
        print("--- STDERR ---")
        print(result.stderr)
    print(f"--- Return code: {result.returncode} ---")

    if result.returncode != 0:
        # Check for known errors and give actionable advice
        output = (result.stdout + result.stderr).lower()
        if "9106" in output or "authentication failed" in output:
            print(
                "\n[deploy] Auth error 9106 detected. Recommendations:"
                "\n  1. Ensure your API Token has: Cloudflare Pages:Edit + Account:Read permissions"
                "\n  2. Or use 'wrangler login' once to authenticate interactively"
                "\n  3. Check token at https://dash.cloudflare.com/profile/api-tokens"
            )
        elif "not found" in output and "project" in output:
            print(
                f"\n[deploy] Project '{PROJECT_NAME}' not found in Cloudflare."
                "\n  Create it first: https://dash.cloudflare.com/pages or run 'wrangler pages project create'"
            )
        return 1

    print("\n[deploy] ✅ Cloudflare Pages deployment succeeded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
