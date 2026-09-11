# -*- coding: utf-8 -*-
"""
Bundle everything this project needs that is NOT in git, for moving to another machine.

Run it yourself; nothing here is printed to a terminal Claude can see, and the bundle is
written outside the repository so it cannot be committed by accident.

    python scripts/export_secrets.py                 # writes to your Downloads folder
    python scripts/export_secrets.py --out D:/       # or anywhere else, e.g. a USB stick
    python scripts/export_secrets.py --no-books      # skip the ~52 MB of PDFs

What it collects, and why each one:

  .env, app/.dev.vars   The only readable copy of most secrets. GitHub Actions secrets and
                        Cloudflare Worker secrets are write-only -- neither the API nor the
                        dashboard will show you a value after it is set -- so if these two
                        files are lost, every secret has to be regenerated and re-entered in
                        both places. They are the backup, not a convenience.

  app/public/books/     Your PDFs. Gitignored on purpose, so a fresh clone has none.

  MANIFEST.txt          Which secret belongs where, and what to run on the new machine.

Deliberately NOT collected:

  app/.wrangler         22 MB of local D1 state. The real database lives in Cloudflare and is
                        untouched by changing laptops; recreate the local one with a migrate.
  node_modules, .venv   Reinstall from the lockfile and requirements.txt.
  gh / wrangler logins  Machine-bound credentials. Log in again rather than copying them.
"""
from __future__ import annotations

import argparse
import io
import os
import json
import subprocess
import sys
import zipfile
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FILES = [".env", os.path.join("app", ".dev.vars")]
BOOKS_DIR = os.path.join("app", "public", "books")


def key_names(path: str) -> list[str]:
    out = []
    try:
        for line in io.open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                out.append(line.split("=", 1)[0].strip())
    except OSError:
        pass
    return out


def gh_secret_names() -> list[str]:
    """GitHub Actions secret names. Values are not retrievable, by design."""
    try:
        r = subprocess.run(
            ["gh", "secret", "list", "--json", "name"],
            capture_output=True, text=True, timeout=90, cwd=ROOT, shell=(os.name == "nt"),
        )
        if r.returncode != 0:
            return []
        return [item["name"] for item in json.loads(r.stdout)]
    except Exception:
        return []


def worker_secret_names() -> list[str]:
    """Cloudflare Worker secret names. Must run from app/, where wrangler.jsonc lives."""
    try:
        r = subprocess.run(
            ["npx", "wrangler", "secret", "list"],
            capture_output=True, text=True, timeout=180,
            cwd=os.path.join(ROOT, "app"), shell=(os.name == "nt"),
        )
        if r.returncode != 0:
            return []
        start = r.stdout.find("[")
        if start == -1:
            return []
        return [item["name"] for item in json.loads(r.stdout[start:])]
    except Exception:
        return []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.expanduser("~"), "Downloads"))
    ap.add_argument("--no-books", action="store_true")
    args = ap.parse_args()

    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    dest = os.path.join(args.out, f"job-search-os-secrets-{stamp}.zip")
    os.makedirs(args.out, exist_ok=True)

    env_keys = key_names(os.path.join(ROOT, ".env"))
    dev_keys = key_names(os.path.join(ROOT, "app", ".dev.vars"))
    gh_keys = gh_secret_names()
    cf_keys = worker_secret_names()
    # Say so rather than printing an empty section that looks like "nothing is set".
    unreachable = [
        name for name, keys in (("GitHub", gh_keys), ("Cloudflare", cf_keys)) if not keys
    ]

    local = set(env_keys) | set(dev_keys)
    orphans = [k for k in cf_keys + gh_keys if k not in local]

    manifest = [
        "job-search-os — what is in this bundle",
        f"exported {datetime.now():%Y-%m-%d %H:%M}",
        "",
        "FILES",
        "  .env               -> repo root",
        "  app/.dev.vars      -> app/",
        "  books/*.pdf        -> app/public/books/   (gitignored; the app reads them from there)",
        "",
        "KEYS FOUND LOCALLY",
        *[f"  .env          {k}" for k in env_keys],
        *[f"  .dev.vars     {k}" for k in dev_keys],
        "",
        "REMOTE SECRETS (names only — these cannot be read back from GitHub or Cloudflare)",
        *[f"  github        {k}" for k in gh_keys],
        *[f"  worker        {k}" for k in cf_keys],
        *[
            f"  !! could not reach the {n} CLI, so its secrets are unlisted here"
            for n in unreachable
        ],
        "",
    ]

    if orphans:
        manifest += [
            "!! SET REMOTELY BUT NOT IN ANY LOCAL FILE",
            "   Nothing can read these back. If you ever need the value again you must",
            "   generate a new one and re-set it. Consider doing that now, while the old",
            "   one still works, and recording it in .env:",
            *[f"     {k}" for k in sorted(set(orphans))],
            "",
        ]

    manifest += [
        "ON THE NEW MACHINE",
        "  1. git clone the repo, then copy .env and app/.dev.vars back into place",
        "  2. copy books/*.pdf into app/public/books/",
        "  3. cd app && npm ci",
        "  4. python -m venv .venv && .venv/Scripts/pip install -r crawler/requirements.txt",
        "  5. npx wrangler login          (browser; do not copy the old machine's token)",
        "  6. gh auth login               (same)",
        "  7. cd app && npx wrangler d1 migrations apply job-search-os --local",
        "     The real database is in Cloudflare and is unaffected by the move; this only",
        "     rebuilds the empty local copy used by `wrangler dev`.",
        "  8. cd app && npm run build && npm run deploy   (confirms the whole chain works)",
        "",
        "AFTERWARDS",
        "  Delete this zip once both machines are set up. It is plaintext secrets.",
        "  If it travelled through cloud storage or email, rotate the app passwords:",
        "  Google app passwords at myaccount.google.com/apppasswords, the GitHub token at",
        "  github.com/settings/personal-access-tokens.",
    ]

    written = []
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in FILES:
            p = os.path.join(ROOT, rel)
            if os.path.isfile(p):
                z.write(p, rel.replace("\\", "/"))
                written.append(rel)
        if not args.no_books:
            bdir = os.path.join(ROOT, BOOKS_DIR)
            if os.path.isdir(bdir):
                for fn in sorted(os.listdir(bdir)):
                    if fn.lower().endswith(".pdf"):
                        z.write(os.path.join(bdir, fn), f"books/{fn}")
                        written.append(f"{BOOKS_DIR}/{fn}")
        z.writestr("MANIFEST.txt", "\n".join(manifest) + "\n")

    size = os.path.getsize(dest) / 1024 / 1024
    print(f"wrote {dest}  ({size:.1f} MiB)")
    for w in written:
        print(f"  + {w}")
    print("  + MANIFEST.txt")
    if orphans:
        print("\nheads up — set remotely but in no local file, so unrecoverable if lost:")
        for k in sorted(set(orphans)):
            print(f"  {k}")
    print("\nThis zip is plaintext secrets. Move it by USB if you can, and delete it after.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
