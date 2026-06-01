#!/usr/bin/env bash
# deploy_now.sh — push the current state of the project to Vercel right now,
# bypassing the interactive watcher. Useful when the watcher isn't running
# or when you want to deploy without confirming each change.
#
#   bash deploy_now.sh
#
# Reads token + project info from deploy.config.json. Re-runs inline_photos.py,
# then uploads index.html + api/*.js to a new production deployment.

cd "$(dirname "$0")"
python3 - <<'PYEOF'
import json, hashlib, pathlib, urllib.request, urllib.error, subprocess, sys, time
PROJ = pathlib.Path(__file__).resolve().parent
cfg = json.loads((PROJ / 'deploy.config.json').read_text())
TOKEN = cfg['token']; PROJECT_ID = cfg['project_id']; PROJECT_NAME = cfg['project_name']
H = {'Authorization': f'Bearer {TOKEN}'}

# Inline imgs first
inliner = PROJ / 'inline_photos.py'
if inliner.exists() and cfg.get('auto_inline', True):
    print('· Inlining img/ photos…')
    subprocess.run([sys.executable, str(inliner)], cwd=PROJ, capture_output=True)

files = [PROJ / 'index.html']
# Superadmin panel sits at /admin/index.html — include it so admin-side
# edits ship together with the main SPA.
admin_idx = PROJ / 'admin' / 'index.html'
if admin_idx.exists():
    files.append(admin_idx)
api = PROJ / 'api'
if api.is_dir():
    files.extend(sorted(api.glob('*.js')))

print(f'· Uploading {len(files)} file(s):')
manifest = []
for fp in files:
    data = fp.read_bytes(); sha = hashlib.sha1(data).hexdigest()
    rel = str(fp.relative_to(PROJ))
    print(f'    {rel:32s} {len(data)/1024:>10.1f} KB')
    req = urllib.request.Request(
        'https://api.vercel.com/v2/files', data=data, method='POST',
        headers={**H, 'Content-Type':'application/octet-stream', 'x-vercel-digest':sha})
    try: urllib.request.urlopen(req, timeout=300).read()
    except urllib.error.HTTPError as e:
        print(f'    upload failed: {e.code} {e.read().decode()[:200]}'); sys.exit(1)
    manifest.append({'file':rel, 'sha':sha, 'size':len(data)})

print('· Creating deployment…')
payload = {'name':PROJECT_NAME, 'project':PROJECT_ID, 'target':'production',
           'files':manifest, 'projectSettings':{'framework':None}}
req = urllib.request.Request(
    'https://api.vercel.com/v13/deployments', data=json.dumps(payload).encode(),
    method='POST', headers={**H, 'Content-Type':'application/json'})
body = json.loads(urllib.request.urlopen(req, timeout=120).read())
dep_id = body.get('id') or body.get('uid')
print(f'  deployment {dep_id}')
print(f'  inspect:    {body.get("inspectorUrl") or body.get("inspector","-")}')

print('· Polling…')
for _ in range(40):
    time.sleep(3)
    s = json.loads(urllib.request.urlopen(
        urllib.request.Request(f'https://api.vercel.com/v13/deployments/{dep_id}', headers=H),
        timeout=20).read())
    state = s.get('readyState') or s.get('status') or '?'
    sys.stdout.write(f'  · {state}      \r'); sys.stdout.flush()
    if state in ('READY','COMPLETED'):
        print('\n  ✓ READY → https://maison-digital-wardrobe.vercel.app/'); break
    if state in ('ERROR','CANCELED'):
        print(f'\n  ✗ {state}'); sys.exit(1)
PYEOF
