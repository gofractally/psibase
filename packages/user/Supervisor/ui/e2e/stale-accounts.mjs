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
    await step(p, `${name}: types a free name, makes a passkey and is taken to verify`, async (page) => {
        await page.goto(`${S}://${app}.${root}/`);
        await page.waitForSelector("#view-welcome:not([hidden])");
        await page.fill("#start-name", "abc");
        await page.click("#btn-create");
        await page.waitForSelector("#notice:not([hidden])", { timeout: 30000 });
        const hint = await page.textContent("#notice");
        await page.fill("#start-name", name);
        await snap(p, "start");
        await page.click("#btn-create");
        await page.waitForSelector("#acct-providers button", { timeout: 60000 });
        if (await sessionSub(p)) throw new Error("the app was given a session before there was an account");
        // Signed in with a passkey but no account: the node does not serve an app's page.
        const tab = await p.context.newPage();
        await tab.goto(`${S}://${app}.${root}/`);
        await tab.waitForLoadState("domcontentloaded");
        const landed = new URL(tab.url());
        await tab.close();
        if (!landed.host.startsWith("supervisor.") || !landed.pathname.endsWith("/sign-in.html")) throw new Error("without an account the app's page was served: " + landed.href);
        // Nor does the node answer an app's API for the passkey-only session's token, beyond what signing up needs.
        const token = await page.evaluate(() => JSON.parse(window.localStorage.getItem("psibase.guest-session.v1") ?? "{}").token);
        if (!token) throw new Error("no passkey session token on the sign-in page");
        const ask = async (svc, path, method = "POST") => (await p.context.request.fetch(`${S}://${svc}.${root}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/graphql" }, data: method === "POST" ? "{ __typename }" : undefined })).status();
        const refused = [await ask("tokens", "/graphql"), await ask(app, "/markets", "GET"), await ask("explorer", "/graphql")];
        const allowed = [await ask("auth-sig", "/graphql"), await ask("dyn-ld", "/graphql"), await ask("tokens", "/plugin.wasm", "GET")];
        if (refused.some((c) => c !== 401)) throw new Error("a passkey-only token was answered by an app's API: " + refused.join(","));
        if (allowed.some((c) => c === 401)) throw new Error("what signing up needs was refused: " + allowed.join(","));
        const creds = (await p.cdp.send("WebAuthn.getCredentials", { authenticatorId: p.authenticatorId })).credentials;
        return `short name: ${hint}; passkeys on the device: ${creds.length}`;
    });
    await step(p, `${name}: verifies with the provider and the name is the one typed`, async (page) => {
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
const sup = `${S}://supervisor.${root}`;
await step(a, "an account remembered by the browser that is not on the network is removed and named as such", async (page) => {
    await page.goto(`${sup}/sign-in.html?step=manage&app=${app}&path=/`);
    await page.waitForSelector("#view-manage:not([hidden])");
    await page.evaluate(() => { const k = "psibase.accounts.v1"; const d = JSON.parse(localStorage.getItem(k)); d.accounts.push({ name: "ghostacct1", ownerSeq: "0", activeSeq: "0", held: true }); d.current = "ghostacct1"; d.apps = { ...d.apps, explorer: "ghostacct1" }; localStorage.setItem(k, JSON.stringify(d)); });
    await page.goto(`${sup}/sign-in.html?app=explorer&path=/`);
    await page.waitForSelector("#acct-notice:not([hidden])", { timeout: 60000 });
    const notice = await page.textContent("#acct-notice");
    const left = await page.evaluate(() => JSON.parse(localStorage.getItem("psibase.accounts.v1")).accounts.map((x) => x.name).join(","));
    if (left.includes("ghost")) throw new Error("still listed: " + left);
    if (!notice.includes("not an account on this network")) throw new Error(notice);
    return `${notice} | left: ${left}`;
});
await step(a, "a browser whose data is from another chain starts clean, keeping only the passkey", async (page) => {
    await page.evaluate(() => localStorage.setItem("psibase.network.v1", "00".repeat(32)));
    await page.goto(`${S}://${app}.${root}/`);
    await page.goto(`${sup}/sign-in.html?app=${app}&path=/`);
    await page.waitForSelector("#view-welcome:not([hidden])", { timeout: 30000 });
    const state = await page.evaluate(() => ({ accounts: localStorage.getItem("psibase.accounts.v1"), session: localStorage.getItem("psibase.guest-session.v1"), passkey: !!localStorage.getItem("psibase.has-passkey.v1") }));
    const text = [await page.textContent("#headline"), await page.textContent("#btn-create-label")].join(" / ");
    if (state.accounts || state.session || !state.passkey) throw new Error(JSON.stringify(state));
    if (text.includes(A)) throw new Error("still greets the old account: " + text);
    // The passkey still works: the account is on this (unchanged) chain, so it comes back.
    if (await page.inputValue("#start-name")) throw new Error("the name field still holds a name from the other chain");
    await page.fill("#start-name", A);
    await page.click("#btn-create");
    await onApp(page);
    return text + " | after the name and the passkey: " + (await expectSub(a, A));
});
await browser.close();
