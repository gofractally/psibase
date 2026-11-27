// Passkey accounts end to end (gofractally/psibase#2275), in Chromium with
// virtual passkeys and a stand-in sign-in provider.
// Usage: node accounts.mjs <port> <nameA> <nameB>
import { chromium } from "playwright-core";
import os from "node:os";
import path from "node:path";

const S = "https";
const port = process.argv[2] ?? "8443";
const A = process.argv[3] ?? "alicetest1";
const B = process.argv[4] ?? "bobtester1";
const A2 = process.argv[5] ?? A.slice(0, -1) + "z";
const A3 = A.slice(0, -1) + "y";
const app = "exchange";
const root = `psibase.localhost:${port}`;
const shots = process.env.SHOTS ?? "/tmp/pw-signin/shots";
const exe = path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1255/chrome-mac-arm64",
    "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const browser = await chromium.launch({ executablePath: exe, headless: true });

const person = async (label) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: "dark" });
    await context.addInitScript(() => {
        if (!navigator.credentials) return;
        for (const m of ["get", "create"]) {
            const orig = navigator.credentials[m].bind(navigator.credentials);
            navigator.credentials[m] = (o) => { if (o && o.publicKey && o.uiMode !== "immediate") console.log("PASSKEY_PROMPT " + m); return orig(o); };
        }
    });
    const page = await context.newPage();
    const log = [];
    page.on("console", (m) => log.push(`[${label} console.${m.type()}] ${m.text().slice(0, 400)}`));
    page.on("pageerror", (e) => log.push(`[${label} pageerror] ${e.message.slice(0, 300)}`));
    page.on("request", (r) => { if (r.method() === "PUT" && r.url().includes("/list/")) log.push(`[${label} LIST_PUT]`); });
    page.on("response", (r) => { if (r.status() >= 400) log.push(`[${label} http ${r.status()}] ${r.request().method()} ${r.url().slice(0, 150)}`); });
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal",
        hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, hasLargeBlob: true, automaticPresenceSimulation: true } });
    return { context, page, log, cdp, label, authenticatorId };
};

let n = 0, current;
const snap = async (p, label) => { await p.page.waitForTimeout(600); await p.page.screenshot({ path: `${shots}/pk-${String(++n).padStart(2, "0")}-${label}.png`, fullPage: true }); };
const step = async (p, label, fn) => {
    current = p;
    try { const out = await fn(p.page); console.log(`ok   ${label}${out ? " — " + out : ""}`); }
    catch (e) {
        console.log(`FAIL ${label} — ${e.message.split("\n")[0]}`);
        await p.page.screenshot({ path: `${shots}/pk-fail.png`, fullPage: true });
        console.log("     at " + p.page.url());
        console.log("     text: " + (await p.page.locator(".si-card, main").first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 500));
        for (const l of p.log.slice(-40)) console.log("     " + l);
        await browser.close(); process.exit(1);
    }
};

const record = async (p, name) => {
    const r = await p.context.request.post(`${S}://auth-sig.${root}/graphql`, { headers: { "Content-Type": "application/graphql" },
        data: `{ account(name: "${name}") { state partner owner { seq } active { seq } pending { kind partner } } }` });
    if (!r.ok()) throw new Error("record query " + r.status() + " " + (await r.text()).slice(0, 120));
    return (await r.json()).data?.account;
};

const sessionSub = async (p, host = app) => {
    const c = (await p.context.cookies(`${S}://${host}.${root}/`)).find((c) => c.name === "__Host-SESSION");
    if (!c) return undefined;
    return JSON.parse(Buffer.from(c.value.split(".")[1], "base64url").toString()).sub;
};
const expectSub = async (p, name) => { const sub = await sessionSub(p); if (sub !== name) throw new Error(`app session is ${sub}, expected ${name}`); return "sub=" + sub; };
const onApp = async (page) => { await page.waitForURL((u) => u.host === `${app}.${root}` && u.pathname === "/", { timeout: 60000 }); await page.waitForLoadState("networkidle"); await page.waitForTimeout(500); };
const manage = async (page, name) => { await page.goto(`${S}://supervisor.${root}/sign-in.html?step=manage&app=${app}&path=/&account=${name}`); await page.waitForSelector("#view-manage:not([hidden])", { timeout: 30000 }); };
const provider = async (page, handle) => { await page.waitForSelector("#login", { timeout: 30000 }); await page.fill("#login", handle); await page.click("#approve"); };
const until = async (what, fn, ms = 30000) => { const end = Date.now() + ms; let last; while (Date.now() < end) { last = await fn(); if (last) return last; await new Promise((r) => setTimeout(r, 700)); } throw new Error("timed out: " + what); };

const signUp = async (p, name) => {
    await step(p, `${name}: picks a name, makes a passkey and enters as a guest`, async (page) => {
        await page.goto(`${S}://${app}.${root}/`);
        await page.waitForSelector("#view-welcome:not([hidden])");
        await page.click("#btn-create");
        await page.waitForSelector("#view-pick:not([hidden])", { timeout: 30000 });
        await page.fill("#pick-name", "abc");
        const hint = await page.textContent("#pick-hint");
        await page.fill("#pick-name", name);
        await page.fill("#pick-display", "Test " + name);
        await page.waitForSelector("#pick-create:not([disabled])");
        await snap(p, "pick");
        await page.click("#pick-create");
        await onApp(page);
        const creds = (await p.cdp.send("WebAuthn.getCredentials", { authenticatorId: p.authenticatorId })).credentials;
        return `short-name hint: ${hint}; passkeys on the device: ${creds.length}`;
    });
    await step(p, `${name}: verifies with the provider and picks a name`, async (page) => {
        await page.goto(`${S}://supervisor.${root}/sign-in.html?step=account&app=${app}&path=/`);
        await page.waitForSelector("#acct-providers button", { timeout: 30000 });
        await page.click("#acct-providers button >> nth=0");
        await provider(page, name);
        await page.waitForSelector("#acct-name-form:not([hidden])", { timeout: 30000 });
        const prefilled = await page.inputValue("#acct-name");
        if (prefilled !== name) throw new Error(`name form holds "${prefilled}", expected the picked name`);
        await page.waitForSelector("#acct-create:not([disabled])");
        await snap(p, "name");
        return "prefilled with the picked name";
    });
    await step(p, `${name}: account is created with owner and active keys`, async (page) => {
        p.log.length = 0;
        await page.click("#acct-create");
        await onApp(page); await page.waitForLoadState("networkidle");
        const r = await record(p, name);
        const prompts = p.log.filter((l) => l.includes("PASSKEY_PROMPT")).length;
        const puts = p.log.filter((l) => l.includes("LIST_PUT")).length;
        return `${await expectSub(p, name)}; state ${r.state}, partner ${r.partner}, seqs ${r.owner.seq}/${r.active.seq}; passkey prompts ${prompts}; writes to the node's list ${puts}`;
    });
};

const a = await person("A");
await signUp(a, A);
// Two tabs of one browser. Tab A's first plugin call can never finish (one
// plugin file never arrives). Tab B must still load its plugins.
const tabA = await a.context.newPage();
let stalled = 0;
await tabA.route(/\/plugin\.wasm$/, (route) => { if (/tokens\./.test(route.request().url())) { stalled++; return; } return route.continue(); });
await tabA.goto(`${S}://${app}.${root}/`);
await tabA.waitForTimeout(6000);
const tabB = await a.context.newPage();
const wasm = [];
tabB.on("request", (r) => { if (/\.wasm$/.test(r.url()) && !r.url().includes("supervisor.")) wasm.push(r.url()); });
const errors = [];
tabB.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
const t0 = Date.now();
await tabB.goto(`${S}://${app}.${root}/`);
let at = -1;
while (Date.now() - t0 < 25000) { if (wasm.length >= 8) { at = Date.now() - t0; break; } await tabB.waitForTimeout(250); }
const locks = await tabB.frames().find((f) => f.url().includes("supervisor."))?.evaluate(async () => { const q = await navigator.locks.query(); return `held ${q.held.map((l) => l.name).join(",") || "-"}; pending ${q.pending.map((l) => l.name).join(",") || "-"}`; }).catch((e) => "ERR " + e.message);
console.log(`tab A: plugin files held back ${stalled}`);
console.log(`tab B: plugin files requested ${wasm.length}${at >= 0 ? ` (8th after ${at} ms)` : " in 25 s"}; locks: ${locks}`);
console.log(wasm.length >= 8 ? "ok   a tab whose call cannot finish does not stop another tab" : "FAIL another tab is stopped by a tab whose call cannot finish");
for (const e of [...new Set(errors)].slice(0, 4)) console.log("     " + e);
await browser.close();
process.exit(wasm.length >= 8 ? 0 : 1);
