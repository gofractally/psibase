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
const fresh = async (page, hosts) => {
    await a.context.clearCookies();
    for (const host of hosts) await a.cdp.send("Storage.clearDataForOrigin", { origin: `${S}://${host}.${root}`, storageTypes: "all" });
    await page.goto(`${S}://${app}.${root}/`);
    await page.waitForSelector("#view-welcome:not([hidden])", { timeout: 30000 });
};
await step(a, "a passkey with no PRF: a free name, the password is shown once in a login form, then verify", async (page) => {
    await page.goto(`${S}://${app}.${root}/`);
    await page.waitForSelector("#view-welcome:not([hidden])");
    const unseen = await page.getAttribute("#start-pass-wrap", "data-unseen");
    await page.fill("#start-name", A);
    await page.click("#btn-create");
    await page.waitForSelector("#fb-keep:not([hidden])", { timeout: 30000 });
    await snap(a, "password");
    wif = (await page.inputValue("#fb-key")).trim();
    if (!/^[KL][1-9A-HJ-NP-Za-km-z]{51}$/.test(wif)) throw new Error("not a base58 key: " + wif.slice(0, 8));
    const shownName = await page.inputValue("#fb-keep-name");
    if (shownName !== A) throw new Error("the form's user name is " + shownName);
    const title = await page.textContent("#fb-title");
    await page.click("#fb-kept");
    await page.waitForSelector("#acct-providers button", { timeout: 60000 });
    if (await sessionSub(a)) throw new Error("the app was given a session before there was an account");
    return `"${title}"; password ${wif.slice(0, 4)}…, ${wif.length} characters; first screen's password field: ${unseen ? "not shown (" + unseen + ")" : "shown"}`;
});
await step(a, "the account is created after the provider check, with keys from the passkey and the password", async (page) => {
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
await step(a, "a new device, nothing filled in: the name, the passkey, then the password on the second screen", async (page) => {
    await fresh(page, ["supervisor", app, "homepage", "x-signup"]);
    a.log.length = 0;
    await page.fill("#start-name", A);
    await page.click("#btn-create");
    await page.waitForSelector("#fb-ask:not([hidden])", { timeout: 30000 });
    const name = await page.inputValue("#fb-name");
    if (name !== A) throw new Error("the second screen's user name is " + name);
    await giveKey(page);
    await onApp(page);
    const prompts = a.log.filter((l) => l.includes("PASSKEY_PROMPT")).length;
    return `${await expectSub(a, A)}; passkey prompts ${prompts}`;
});
await step(a, "a new device where a manager filled the first screen: no second screen", async (page) => {
    await fresh(page, ["supervisor", app, "homepage", "x-signup"]);
    await page.fill("#start-name", A);
    // What a password manager does: sets the value of the field that is not shown.
    await page.evaluate((v) => { const i = document.getElementById("start-pass"); i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); }, wif);
    let asked = false;
    page.waitForSelector("#fb-ask:not([hidden])", { timeout: 20000 }).then(() => (asked = true), () => {});
    await page.click("#btn-create");
    await onApp(page);
    if (asked) throw new Error("the second screen was shown although the password was filled");
    return await expectSub(a, A);
});
await step(a, "same device again: it knows the passkey needs a password, so the field is shown", async (page) => {
    await a.context.clearCookies();
    await page.goto(`${S}://supervisor.${root}/sign-in.html?app=${app}&path=/`);
    // Signed in already: sign out of this browser first, keeping what it knows of the passkey.
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => window.localStorage.removeItem("psibase.guest-session.v1"));
    await page.goto(`${S}://supervisor.${root}/sign-in.html?app=${app}&path=/`);
    await page.waitForSelector("#view-welcome:not([hidden])", { timeout: 30000 });
    const unseen = await page.getAttribute("#start-pass-wrap", "data-unseen");
    if (unseen) throw new Error("the password field is still not shown: " + unseen);
    if (!(await page.isVisible("#start-pass"))) throw new Error("the password field is not visible");
    await snap(a, "start-with-password");
    return `prefilled name "${await page.inputValue("#start-name")}"`;
});
await step(a, "a wrong password says so and asks again in plain sight; it never opens another identity", async (page) => {
    await fresh(page, ["supervisor", app]);
    await page.fill("#start-name", A);
    await page.click("#btn-create");
    await page.waitForSelector("#fb-ask:not([hidden])", { timeout: 30000 });
    await page.fill("#fb-input", "KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617");
    await page.click("#fb-form button[type=submit]");
    await page.waitForSelector("#notice:not([hidden])", { timeout: 60000 });
    const notice = await page.textContent("#notice");
    if (!/does not open/.test(notice)) throw new Error("notice: " + notice);
    if (await sessionSub(a)) throw new Error("an app session exists after a wrong password");
    if (!(await page.isVisible("#start-pass"))) throw new Error("the password field is not shown for the retry");
    // The retry, with the right one typed into the now-visible field.
    await page.fill("#start-pass", wif);
    await page.click("#btn-create");
    await onApp(page);
    return `"${notice.slice(0, 60)}…"; retry: ${await expectSub(a, A)}`;
});
for (const l of [...new Set(a.log.filter((l) => l.includes("pageerror") || l.includes("console.error")))].slice(-6)) console.log("     " + l);
await browser.close();
