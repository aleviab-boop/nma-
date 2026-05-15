#!/usr/bin/env python3
"""
deploy_watch.py — watch the project for changes, confirm, deploy to Vercel.

On first run, the script asks for your deployment method and saves it to
deploy.config.json. Subsequent runs skip the prompt.

Methods:
  1) Vercel API (token)        — recommended. Direct upload, no Git, no CLI.
                                  Auto-runs inline_photos.py first so every
                                  image in img/ is baked into index.html before
                                  upload (the production site doesn't need an
                                  img/ folder at all).
  2) Vercel Deploy Hook URL    — for Git-connected projects. POSTs the URL.
  3) Vercel CLI                — runs `vercel --prod --yes` (needs `npm i -g vercel`).
  4) Git push                  — `git add -A && git commit && git push`.
  5) Custom shell command      — anything you write.

Steady state: polls index.html, README.md, inline_photos.py, and img/ every 2 s.
On change → prompts y/N/s. `y` runs the configured method.
"""
from __future__ import annotations
import hashlib
import json
import os
import pathlib
import shlex
import shutil
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime

PROJ = pathlib.Path(__file__).resolve().parent
CONFIG = PROJ / 'deploy.config.json'
INDEX_HTML = PROJ / 'index.html'
INLINER = PROJ / 'inline_photos.py'

WATCH_PATHS = ['index.html', 'README.md', 'inline_photos.py', 'img', 'api']
IGNORE_NAMES = {'.DS_Store', '.git', '.vercel', '__pycache__', 'node_modules',
                'deploy.config.json', 'deploy_watch.py'}
POLL_INTERVAL = 2.0
VERCEL_API = 'https://api.vercel.com'

# ---------- pretty logging ----------

def _c(name: str) -> str:
    return {'red':'\033[31m','green':'\033[32m','yellow':'\033[33m','blue':'\033[34m',
            'gold':'\033[38;5;220m','dim':'\033[2m','reset':'\033[0m'}.get(name,'')

def log(msg: str, color: str = '') -> None:
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"{_c('dim')}[{ts}]{_c('reset')} {_c(color)}{msg}{_c('reset') if color else ''}")

# ---------- file scanning ----------

def iter_files() -> list[pathlib.Path]:
    seen: list[pathlib.Path] = []
    for entry in WATCH_PATHS:
        p = PROJ / entry
        if not p.exists(): continue
        if p.is_file():
            seen.append(p)
        else:
            for child in p.rglob('*'):
                if child.is_file() and not any(part in IGNORE_NAMES for part in child.parts):
                    seen.append(child)
    return seen

def snapshot() -> dict[str, float]:
    snap: dict[str, float] = {}
    for f in iter_files():
        try: snap[str(f.relative_to(PROJ))] = f.stat().st_mtime
        except FileNotFoundError: pass
    return snap

def diff_snapshots(old: dict[str, float], new: dict[str, float]) -> list[tuple[str, str]]:
    changes = []
    for k, v in new.items():
        if k not in old: changes.append(('+', k))
        elif old[k] != v: changes.append(('~', k))
    for k in old:
        if k not in new: changes.append(('-', k))
    return changes

# ---------- config ----------

def load_config() -> dict | None:
    if CONFIG.exists():
        try: return json.loads(CONFIG.read_text())
        except json.JSONDecodeError:
            log('deploy.config.json is malformed — re-running setup.', 'yellow')
    return None

def save_config(cfg: dict) -> None:
    CONFIG.write_text(json.dumps(cfg, indent=2) + '\n')
    log(f"Saved deploy config → {CONFIG.name}", 'green')

def first_run_setup() -> dict:
    print()
    log('First-time setup — pick your deploy method:', 'gold')
    print('  1) Vercel API token   (recommended — direct upload, no CLI)')
    print('  2) Vercel Deploy Hook (for Git-connected projects)')
    print('  3) Vercel CLI         (requires `npm i -g vercel`)')
    print('  4) Git push           (your repo is connected to Vercel)')
    print('  5) Custom shell command')
    print()
    choice = input('Choose [1-5]: ').strip()

    if choice == '1':
        token = input('Vercel API token: ').strip()
        if not token.startswith('vcp_') and not token.startswith('vercel_'):
            log('Token format looks unusual — continuing anyway.', 'yellow')
        log('Looking up project…', 'dim')
        project = vercel_pick_project(token)
        if not project: sys.exit(1)
        return {
            'method': 'api',
            'token': token,
            'project_id': project['id'],
            'project_name': project['name'],
            'auto_inline': True
        }
    if choice == '2':
        url = input('Paste the Deploy Hook URL: ').strip()
        if not url.startswith('http'):
            log('That does not look like a URL.', 'red'); sys.exit(1)
        return {'method': 'hook', 'url': url}
    if choice == '3':
        if not shutil.which('vercel'):
            log('Vercel CLI not on PATH. `npm i -g vercel` first.', 'yellow'); sys.exit(1)
        return {'method': 'cli'}
    if choice == '4':
        if not shutil.which('git'):
            log('git not on PATH.', 'red'); sys.exit(1)
        msg = input('Default commit message: ').strip()
        return {'method': 'git', 'message': msg or 'deploy: latest changes'}
    if choice == '5':
        cmd = input('Shell command: ').strip()
        if not cmd: sys.exit(1)
        return {'method': 'shell', 'command': cmd}
    log('Unknown choice.', 'red'); sys.exit(1)

def vercel_pick_project(token: str) -> dict | None:
    try:
        req = urllib.request.Request(f'{VERCEL_API}/v9/projects',
                                     headers={'Authorization': f'Bearer {token}'})
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        log(f'Token rejected: HTTP {e.code}', 'red'); return None
    projects = data.get('projects', [])
    if not projects:
        log('No projects found on this token.', 'red'); return None
    if len(projects) == 1:
        p = projects[0]
        log(f"Using project: {p['name']}  ({p['id']})", 'green')
        return p
    print()
    log(f'{len(projects)} projects on this account:', 'blue')
    for i, p in enumerate(projects, 1):
        print(f"  {i}) {p['name']}  · {p['id']}")
    idx = input(f'Choose [1-{len(projects)}]: ').strip()
    try: return projects[int(idx) - 1]
    except (ValueError, IndexError):
        log('Invalid choice.', 'red'); return None

# ---------- deploy actions ----------

def run_deploy(cfg: dict) -> bool:
    method = cfg['method']
    log(f'Deploying via {method}…', 'gold')
    try:
        if method == 'api':   return deploy_via_api(cfg)
        if method == 'hook':  return run_hook(cfg['url'])
        if method == 'cli':   return run_cmd(['vercel', '--prod', '--yes'])
        if method == 'git':   return run_git(cfg.get('message', 'deploy: latest changes'))
        if method == 'shell': return run_cmd(cfg['command'], shell=True)
    except KeyboardInterrupt:
        log('Cancelled.', 'yellow'); return False
    except Exception as e:
        log(f'Deploy failed: {e}', 'red'); return False
    log(f'Unknown method: {method}', 'red'); return False

def deploy_via_api(cfg: dict) -> bool:
    """Inline images → upload index.html + api/*.js → create production deployment."""
    token = cfg['token']
    project_id = cfg['project_id']
    project_name = cfg['project_name']

    if cfg.get('auto_inline', True) and INLINER.exists():
        log('Re-running inline_photos.py to bake every img/ file into index.html…', 'dim')
        proc = subprocess.run([sys.executable, str(INLINER)], cwd=PROJ, capture_output=True, text=True)
        if proc.returncode != 0:
            log('inline_photos.py failed:', 'red'); print(proc.stdout); print(proc.stderr)
            return False
        for line in proc.stdout.splitlines():
            if 'Embedded' in line or 'updated' in line:
                log('  ' + line, 'dim')

    if not INDEX_HTML.exists():
        log('index.html missing.', 'red'); return False

    # Build the file manifest: index.html + every .js under api/
    files_to_send = [INDEX_HTML]
    api_dir = PROJ / 'api'
    if api_dir.is_dir():
        for f in sorted(api_dir.glob('*.js')):
            files_to_send.append(f)

    manifest = []
    for fp in files_to_send:
        data = fp.read_bytes()
        sha1 = hashlib.sha1(data).hexdigest()
        size = len(data)
        rel = str(fp.relative_to(PROJ))
        log(f'Uploading {rel}  ({size/1024:.1f} KB · sha1 {sha1[:10]}…)', 'dim')
        req = urllib.request.Request(
            f'{VERCEL_API}/v2/files',
            data=data,
            method='POST',
            headers={
                'Authorization': f'Bearer {token}',
                'Content-Type': 'application/octet-stream',
                'x-vercel-digest': sha1,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                resp.read()
        except urllib.error.HTTPError as e:
            log(f'Upload failed: HTTP {e.code}\n{e.read().decode()[:400]}', 'red'); return False
        except urllib.error.URLError as e:
            log(f'Upload unreachable: {e.reason}', 'red'); return False
        manifest.append({'file': rel, 'sha': sha1, 'size': size})

    # 2. Create deployment with the full manifest
    payload = {
        'name': project_name,
        'project': project_id,
        'target': 'production',
        'files': manifest,
        'projectSettings': {'framework': None},
    }
    req = urllib.request.Request(
        f'{VERCEL_API}/v13/deployments',
        data=json.dumps(payload).encode(),
        method='POST',
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        log(f'Deploy failed: HTTP {e.code}\n{e.read().decode()[:400]}', 'red'); return False

    dep_id = body.get('id') or body.get('uid')
    inspector = body.get('inspectorUrl') or body.get('inspector')
    log(f'Deployment created  ({dep_id})', 'green')
    if inspector: log(f'  inspect → {inspector}', 'dim')

    # 3. Poll until READY
    log('Waiting for build…', 'dim')
    state_url = f'{VERCEL_API}/v13/deployments/{dep_id}'
    for attempt in range(60):
        time.sleep(3)
        try:
            sreq = urllib.request.Request(state_url, headers={'Authorization': f'Bearer {token}'})
            with urllib.request.urlopen(sreq, timeout=20) as r:
                s = json.loads(r.read())
            state = s.get('readyState') or s.get('status') or 'BUILDING'
            sys.stdout.write(f'  · {state}\r'); sys.stdout.flush()
            if state in ('READY', 'COMPLETED'):
                print()
                domains = []
                for a in s.get('aliasAssigned', []) or []: domains.append(a)
                domains.append(s.get('url',''))
                log('✓ READY', 'green')
                # Hit the production alias to nudge cache
                aliases = vercel_get_aliases(token, project_id)
                for d in aliases[:3]: log(f'  https://{d}', 'green')
                return True
            if state in ('ERROR', 'CANCELED'):
                print(); log(f'Build {state}', 'red'); return False
        except Exception as e:
            sys.stdout.write(f'  poll error: {e}\r')
    print(); log('Timed out waiting for build.', 'yellow'); return False

def vercel_get_aliases(token: str, project_id: str) -> list[str]:
    try:
        req = urllib.request.Request(f'{VERCEL_API}/v9/projects/{project_id}/domains',
                                     headers={'Authorization': f'Bearer {token}'})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        return [d['name'] for d in data.get('domains', [])]
    except Exception:
        return []

def run_hook(url: str) -> bool:
    req = urllib.request.Request(url, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            log(f'Hook responded HTTP {resp.status}', 'green')
            return 200 <= resp.status < 300
    except urllib.error.HTTPError as e:
        log(f'Hook responded HTTP {e.code}', 'red'); return False
    except urllib.error.URLError as e:
        log(f'Hook unreachable: {e.reason}', 'red'); return False

def run_cmd(cmd, shell: bool = False) -> bool:
    if isinstance(cmd, str) and not shell: cmd = shlex.split(cmd)
    log(f'$ {cmd if shell else " ".join(cmd)}', 'dim')
    return subprocess.run(cmd, cwd=PROJ, shell=shell).returncode == 0

def run_git(message: str) -> bool:
    stamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    if not run_cmd(['git', 'add', '-A']): return False
    proc = subprocess.run(['git', 'commit', '-m', f'{message} · {stamp}'], cwd=PROJ,
                          capture_output=True, text=True)
    if proc.returncode != 0 and 'nothing to commit' not in (proc.stdout + proc.stderr):
        sys.stdout.write(proc.stdout); sys.stderr.write(proc.stderr); return False
    return run_cmd(['git', 'push'])

# ---------- main loop ----------

def prompt_deploy(changes: list[tuple[str, str]]) -> str:
    sym_color = {'+': 'green', '~': 'yellow', '-': 'red'}
    print(); log(f'{len(changes)} change(s) detected:', 'blue')
    for sym, path in changes[:25]:
        log(f'  {sym} {path}', sym_color.get(sym, ''))
    if len(changes) > 25: log(f'  …and {len(changes) - 25} more', 'dim')
    while True:
        ans = input('Deploy to Vercel? [y / N / s=skip] ').strip().lower()
        if ans in ('y', 'yes'): return 'yes'
        if ans in ('', 'n', 'no', 's', 'skip'): return 'skip'
        print('  (y / n / s)')

def main() -> None:
    log(f'deploy_watch.py — watching {PROJ}', 'gold')
    cfg = load_config() or first_run_setup()
    if not CONFIG.exists(): save_config(cfg)
    if cfg.get('method') == 'api':
        log(f"Method: api · project {cfg.get('project_name')}  ({cfg.get('project_id')})", 'blue')
    else:
        log(f"Method: {cfg['method']}", 'blue')
    log(f'Watching: {", ".join(WATCH_PATHS)}  ·  poll {POLL_INTERVAL}s  ·  Ctrl-C to quit', 'dim')

    last = snapshot()
    while True:
        try:
            time.sleep(POLL_INTERVAL)
            now = snapshot()
            changes = diff_snapshots(last, now)
            if not changes: continue
            decision = prompt_deploy(changes)
            if decision == 'yes':
                ok = run_deploy(cfg)
                log('✓ Deploy succeeded' if ok else '✗ Deploy failed', 'green' if ok else 'red')
            else:
                log('Skipping — will ask on next change.', 'dim')
            last = now
        except KeyboardInterrupt:
            print(); log('Stopped watching.', 'gold'); return

if __name__ == '__main__':
    main()
