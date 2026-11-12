# Browser e2e (Playwright) against scripts/e2e/workspace-server.mjs on :8899.
# Users: stockkeeper (stock), accountant (accounts), root, nobody.
from playwright.sync_api import sync_playwright
BASE="http://127.0.0.1:8899"
results=[]
def check(name, ok, extra=""):
    results.append(ok); print(("PASS " if ok else "FAIL ")+name+(("  "+extra) if extra else ""))

with sync_playwright() as p:
    b=p.chromium.launch()
    def session(user):
        ctx=b.new_context(service_workers="block")
        ctx.add_cookies([{"name":"fos_session","value":f"sess-{user}","url":BASE}])
        pg=ctx.new_page()
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        api=[]; pg.on("response", lambda r: api.append((r.status, r.url.replace(BASE,""))) if "/api/" in r.url else None)
        return ctx,pg,errs,api

    # 1. Non-admin lands on /session and sees only their workspace
    ctx,pg,errs,api=session("stockkeeper")
    pg.goto(BASE+"/"); pg.wait_for_url("**/session", timeout=15000)
    pg.get_by_role("heading", name="Workspace").wait_for(timeout=15000)
    check("stockkeeper: / lands on /session", pg.url.endswith("/session"), pg.url)
    cards=pg.locator("h3").all_inner_texts()
    check("stockkeeper: grid shows only Stock", cards==["Stock"], str(cards))
    check("stockkeeper: no Automations nav item", pg.get_by_role("button", name="Automations").count()==0)
    pg.screenshot(path="/tmp/shot-session-grid.png", full_page=True)
    # 2. Open → dashboard renders under /session/stock via the session API
    pg.locator("text=Open →").first.click(); pg.wait_for_url("**/session/stock", timeout=10000)
    pg.wait_for_timeout(2500)
    hit=[a for a in api if "/api/session/workspaces/stock/data" in a[1]]
    check("stock dashboard fetched via /api/session/workspaces/stock/data", bool(hit) and hit[-1][0]==200, str(hit[-1:]))
    check("no request to deprecated /api/automations/*/data", not any("/api/automations/" in a[1] and "/data" in a[1] for a in api))
    check("frame shows back + pin", pg.locator("text=All workspaces").count()==1 and pg.locator("text=Pin this dashboard").count()==1)
    pg.screenshot(path="/tmp/shot-session-stock.png", full_page=True)
    # pin persists and shows on the grid
    pg.locator("text=Pin this dashboard").click(); pg.locator("text=All workspaces").click(); pg.wait_for_url("**/session")
    pg.wait_for_timeout(800)
    check("pinned workspace shows in Pinned section", pg.locator("text=📌 Pinned").count()>=1)
    # 3. legacy /automations/stock bookmark → /session/stock (replace)
    pg.goto(BASE+"/automations/stock"); pg.wait_for_url("**/session/stock", timeout=10000)
    pg.wait_for_timeout(1500)
    check("legacy /automations/stock → /session/stock", pg.url.endswith("/session/stock"), pg.url)
    check("stockkeeper: no page errors", not errs, "; ".join(errs)[:200])
    ctx.close()

    # 4. legacy alias slug for accountant
    ctx,pg,errs,api=session("accountant")
    pg.goto(BASE+"/automations/payment-tracker"); pg.wait_for_url("**/session/debtors-tracker", timeout=10000)
    pg.wait_for_timeout(2500)
    check("accountant: /automations/payment-tracker → /session/debtors-tracker", pg.url.endswith("/session/debtors-tracker"), pg.url)
    hit=[a for a in api if "debtors-tracker" in a[1] and "/data" in a[1]]
    check("accountant: debtors data allowed (legacy accounts scope)", all(s==200 for s,_ in hit) if hit else True, str(hit[:2]))
    pg.goto(BASE+"/session"); pg.get_by_role("heading", name="Workspace").wait_for()
    pg.wait_for_timeout(800)
    cards=sorted(pg.locator("h3").all_inner_texts())
    check("accountant: grid shows Accounts + Debtors Tracker", cards==sorted(["Accounts","Debtors Tracker"]), str(cards))
    check("accountant: no page errors", not errs, "; ".join(errs)[:200])
    ctx.close()

    # 5. Admin lands on /automations registry, opens a dashboard in Workspace
    ctx,pg,errs,api=session("root")
    pg.goto(BASE+"/"); pg.wait_for_url("**/automations", timeout=15000)
    pg.get_by_role("heading", name="Automations").wait_for(timeout=15000)
    pg.wait_for_timeout(1500)
    check("root: / lands on /automations", pg.url.endswith("/automations"), pg.url)
    check("root: registry cards render", pg.get_by_role("button", name="📊 Open in Workspace").count()>3, str(pg.get_by_role("button", name="📊 Open in Workspace").count()))
    pg.screenshot(path="/tmp/shot-automations.png", full_page=True)
    pg.get_by_role("button", name="📊 Open in Workspace").first.click(); pg.wait_for_url("**/session/*", timeout=10000)
    check("root: registry 'Open' → /session/<slug>", "/session/" in pg.url, pg.url)
    pg.goto(BASE+"/session"); pg.get_by_role("heading", name="Workspace").wait_for(); pg.wait_for_timeout(800)
    check("root: Workspace grid lists all dashboards", pg.locator("h3").count()>=15, str(pg.locator("h3").count()))
    check("root: no page errors", not errs, "; ".join(errs)[:200])
    ctx.close()

    # 6. User with no grants
    ctx,pg,errs,api=session("nobody")
    pg.goto(BASE+"/"); pg.wait_for_timeout(3000)
    check("nobody: sees Access pending", pg.locator("text=Access pending").count()==1, pg.url)
    ctx.close()
    b.close()
print(f"\n{sum(results)}/{len(results)} passed")
