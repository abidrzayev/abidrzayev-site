"""Headless render test: python tests/render.py  (starts a local server, opens every page in EN and DE, fails on console errors)."""
import subprocess, sys, time, os, pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
shots = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
if shots: shots.mkdir(exist_ok=True, parents=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8765", "--bind", "127.0.0.1"], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
pages = ["index.html", "projects/rossmann.html", "projects/inventory.html", "projects/sourcing.html", "projects/operations.html", "legal/impressum.html", "legal/datenschutz.html"]
bad = 0
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        for lang in ("en", "de"):
            for pg in pages:
                ctx = b.new_context(viewport={"width": 1280, "height": 900}); page = ctx.new_page(); errs = []
                page.on("console", lambda m: errs.append(m.text) if m.type in ("error", "warning") else None)
                page.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
                page.goto(f"http://127.0.0.1:8765/{pg}?lang={lang}"); page.wait_for_timeout(1200)
                charts = page.evaluate("document.querySelectorAll('canvas').length")
                drawn = page.evaluate("Array.from(document.querySelectorAll('canvas')).filter(c=>c.width>0&&c.height>0&&window.Chart&&Chart.getChart(c)).length")
                empty_i18n = page.evaluate("Array.from(document.querySelectorAll('[data-i18n]')).filter(e=>!e.textContent.trim()).length")
                raw = page.evaluate("Array.from(document.querySelectorAll('main *:not(code)')).filter(e=>e.children.length==0&&/^[a-z]+\\.[a-z0-9.]+$/.test(e.textContent.trim())).length")
                ok = not errs and drawn == charts and empty_i18n == 0 and raw == 0
                print(("OK  " if ok else "FAIL"), lang, pg, f"charts {drawn}/{charts}", errs[:3], "raw-keys", raw)
                if not ok: bad += 1
                if shots: page.screenshot(path=str(shots / f"{pg.replace('/','_')}_{lang}.png"), full_page=True)
                ctx.close()
        b.close()
finally:
    srv.terminate()
sys.exit(1 if bad else 0)
