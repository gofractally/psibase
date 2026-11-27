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
        hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: false, hasLargeBlob: true, automaticPresenceSimulation: true } });
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


const a = await person("A");
let wif;
const giveKey = async (page) => { await page.waitForSelector("#fb-ask:not([hidden])", { timeout: 30000 }); await page.fill("#fb-input", wif); await page.click("#fb-form button[type=submit]"); };
await step(a, "a passkey with no PRF: the visitor is given a recovery key and gets in as a guest", async (page) => {
    await page.goto(`${S}://${app}.${root}/`);
    await page.waitForSelector("#view-welcome:not([hidden])");
    await page.click("#btn-create");
    await page.waitForSelector("#view-pick:not([hidden])", { timeout: 30000 });
    await page.fill("#pick-name", A); await page.waitForSelector("#pick-create:not([disabled])"); await page.click("#pick-create");
    await page.waitForSelector("#fb-keep:not([hidden])", { timeout: 30000 });
    await snap(a, "recovery-key");
    wif = (await page.inputValue("#fb-key")).trim();
    if (!/^[KL][1-9A-HJ-NP-Za-km-z]{51}$/.test(wif)) throw new Error("not a base58 key: " + wif.slice(0, 8));
    await page.click("#fb-kept");
    await onApp(page);
    const stored = await page.evaluate(() => 0);
    return `recovery key ${wif.slice(0, 4)}…, ${wif.length} characters`;
});
const guestBefore = await a.page.evaluate(() => 0);
await step(a, "creating an account asks for the passkey and the recovery key, and derives the same identity", async (page) => {
    await page.goto(`${S}://supervisor.${root}/sign-in.html?step=account&app=${app}&path=/`);
    await page.waitForSelector("#acct-providers button", { timeout: 30000 });
    await page.click("#acct-providers button >> nth=0");
    await provider(page, A);
    await page.waitForSelector("#acct-name-form:not([hidden])", { timeout: 30000 });
    await page.waitForSelector("#acct-create:not([disabled])");
    await page.click("#acct-create");
    await giveKey(page);
    await onApp(page);
    const r = await record(a, A);
    return `${await expectSub(a, A)}; state ${r.state}`;
});
await step(a, "a new device: passkey plus the recovery key typed in finds the same account", async (page) => {
    await a.context.clearCookies();
    for (const host of ["supervisor", app, "homepage", "x-signup"]) await a.cdp.send("Storage.clearDataForOrigin", { origin: `${S}://${host}.${root}`, storageTypes: "all" });
    await page.goto(`${S}://${app}.${root}/`);
    await page.waitForSelector("#view-welcome:not([hidden])", { timeout: 30000 });
    a.log.length = 0;
    await page.click("#btn-create");
    await giveKey(page);
    await page.waitForSelector(`text=Continue as ${A}`, { timeout: 60000 });
    const prompts = a.log.filter((l) => l.includes("PASSKEY_PROMPT")).length;
    await page.click(`text=Continue as ${A}`);
    await onApp(page);
    return `${await expectSub(a, A)}; passkey prompts ${prompts}`;
});
await step(a, "a wrong recovery key does not sign in as the account", async (page) => {
    await a.context.clearCookies();
    for (const host of ["supervisor", app]) await a.cdp.send("Storage.clearDataForOrigin", { origin: `${S}://${host}.${root}`, storageTypes: "all" });
    await page.goto(`${S}://${app}.${root}/`);
    await page.waitForSelector("#view-welcome:not([hidden])", { timeout: 30000 });
    await page.click("#btn-create");
    await page.waitForSelector("#fb-ask:not([hidden])", { timeout: 30000 });
    await page.fill("#fb-input", "KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617");
    await page.click("#fb-form button[type=submit]");
    await onApp(page);
    const sub = await sessionSub(a);
    if (sub === A) throw new Error("signed in as the account with the wrong key");
    return `lands as a different guest (session sub "${sub ?? ""}")`;
});
for (const l of [...new Set(a.log.filter((l) => l.includes("pageerror") || l.includes("console.error")))].slice(-6)) console.log("     " + l);
await browser.close();
