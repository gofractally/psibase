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

await step(a, "new device: passkey alone finds the account and signs in as it", async (page) => {
    await a.context.clearCookies();
    for (const host of ["supervisor", app, "homepage", "x-signup"]) {
        await a.cdp.send("Storage.clearDataForOrigin", { origin: `${S}://${host}.${root}`, storageTypes: "all" });
    }
    await page.goto(`${S}://${app}.${root}/`);
    await page.waitForSelector("#view-welcome:not([hidden])", { timeout: 30000 });
    await page.click("#btn-create");
    // The passkey found the account; the visitor says whether this app may see it.
    await page.waitForSelector(`text=Continue as ${A}`, { timeout: 60000 });
    const before = await sessionSub(a);
    if (before === A) throw new Error("the app was given the account before it was chosen");
    await snap(a, "chooser");
    const offered = (await page.locator("#acct-list button").allTextContents()).join(" / ");
    await page.click(`text=Continue as ${A}`);
    await onApp(page);
    return `${await expectSub(a, A)}; offered: ${offered}`;
});

await step(a, "manage view shows the account, its partner and usage", async (page) => {
    await manage(page, A);
    await snap(a, "manage");
    const text = (await page.innerText("#mg-body")).replace(/\s+/g, " ");
    for (const want of ["In use", "Sign out other devices", "Requests"]) if (!text.includes(want)) throw new Error(`missing "${want}" in: ${text.slice(0, 300)}`);
    if (text.includes("Freeze this account")) throw new Error("freeze is shown outside the Security tab");
    await page.click(".si-tab >> text=Security");
    await page.waitForSelector("text=Freeze this account");
    await snap(a, "security");
    const sec = (await page.innerText("#mg-body")).replace(/\s+/g, " ");
    if (!sec.includes("Recovery partner")) throw new Error("no recovery partner on the Security tab");
    await page.click(".si-tab >> text=Account");
    await page.waitForSelector("text=Sign out other devices");
    return text.slice(0, 120);
});

await step(a, "sign out other devices: the active key is replaced and this browser still signs", async (page) => {
    await page.click("text=Sign out other devices");
    await until("active seq 1", async () => (await record(a, A)).active.seq == 1);
    await page.waitForSelector("#mg-notice:not([hidden])", { timeout: 30000 });
    const notice = await page.textContent("#mg-notice");
    await page.goto(`${S}://supervisor.${root}/sign-in.html?step=account&app=${app}&path=/`);
    await page.click(`text=Continue as ${A}`);
    await onApp(page); await page.waitForLoadState("networkidle");
    return `${await expectSub(a, A)}; ${notice.slice(0, 60)}`;
});

await step(a, "pause, then the sign-up service ends it after a provider sign-in", async (page) => {
    await manage(page, A); await page.click(".si-tab >> text=Security");
    await page.click("text=Pause this account"); await page.click("text=click again to confirm");
    await until("paused", async () => (await record(a, A)).state.toLowerCase() === "paused");
    await page.waitForSelector("text=End the pause now", { timeout: 30000 });
    await snap(a, "paused");
    await page.click("text=End the pause now");
    await page.waitForSelector("#acct-providers button", { timeout: 30000 });
    await page.click("#acct-providers button >> nth=0");
    await provider(page, A);
    await until("normal again", async () => (await record(a, A)).state.toLowerCase() === "normal", 60000);
    await onApp(page);
    return expectSub(a, A);
});

await step(a, "freeze, then recover with new keys through the sign-up service", async (page) => {
    await manage(page, A); await page.click(".si-tab >> text=Security");
    await page.click("text=Freeze this account"); await page.click("text=click again to confirm");
    await until("frozen", async () => (await record(a, A)).state.toLowerCase() === "frozen");
    await page.waitForSelector("text=Recover this account", { timeout: 30000 });
    await snap(a, "frozen");
    await page.click("text=Recover this account");
    await page.waitForSelector("#acct-providers button", { timeout: 30000 });
    await page.click("#acct-providers button >> nth=0");
    await provider(page, A);
    await onApp(page); await page.waitForLoadState("networkidle");
    const r = await record(a, A);
    if (r.state.toLowerCase() !== "normal" || r.owner.seq != 1) throw new Error("after recovery: " + JSON.stringify(r));
    return `${await expectSub(a, A)}; owner seq ${r.owner.seq}`;
});

await step(a, "Create another account from the manage view makes a second account under the same passkey", async (page) => {
    await manage(page, A);
    await page.click("text=Create another account");
    await page.waitForSelector("#acct-name-form:not([hidden])", { timeout: 30000 });
    const title = await page.textContent("#acct-title");
    await page.fill("#acct-name", A2);
    await page.waitForSelector("#acct-create:not([disabled])");
    await snap(a, "second-account");
    await page.click("#acct-create");
    await onApp(page);
    const r = await record(a, A2);
    if (r.partner !== A) throw new Error("partner of the second account is " + r.partner);
    await manage(page, A2);
    const names = await page.locator(".si-acct .si-dest-host").allTextContents();
    return `${title}; ${await expectSub(a, A2)}; partner ${r.partner}; on this browser: ${names.join(", ")}`;
});

await step(a, "new device again: both accounts come back from the passkey", async (page) => {
    a.log.length = 0;
    await a.context.clearCookies();
    for (const host of ["supervisor", app, "homepage", "x-signup"]) {
        await a.cdp.send("Storage.clearDataForOrigin", { origin: `${S}://${host}.${root}`, storageTypes: "all" });
    }
    await page.goto(`${S}://${app}.${root}/`);
    await page.waitForSelector("#view-welcome:not([hidden])", { timeout: 30000 });
    await page.click("#btn-create");
    await page.waitForSelector(`text=Continue as ${A2}`, { timeout: 60000 });
    const offered = (await page.locator("#acct-list button").allTextContents()).join(" / ");
    await page.click(`text=Continue as ${A}`);
    await onApp(page);
    const listReads = a.log.filter((l) => l.includes("/list/")).length;
    return `${await expectSub(a, A)}; offered: ${offered}; requests to the node's list: ${listReads}`;
});

await step(a, "another app: a new account is created for it by a chosen account, and the app sees only that one", async (page) => {
    await page.goto(`${S}://supervisor.${root}/sign-in.html?app=homepage&path=/`);
    await page.waitForSelector("text=Create a new account for this app", { timeout: 60000 });
    await page.click("text=Create a new account for this app");
    await page.waitForSelector(`text=Create with ${A2}`, { timeout: 30000 });
    await snap(a, "which-creates");
    const asked = await page.textContent("#acct-title");
    await page.click(`text=Create with ${A2}`);
    await page.waitForSelector("#acct-name-form:not([hidden])", { timeout: 30000 });
    await page.fill("#acct-name", A3);
    await page.waitForSelector("#acct-create:not([disabled])");
    await page.click("#acct-create");
    await page.waitForURL((u) => u.host.startsWith("network."), { timeout: 60000 });
    await page.waitForLoadState("networkidle"); await page.waitForTimeout(1500);
    const home = await sessionSub(a, "network");
    const r = await record(a, A3);
    if (home !== A3) throw new Error("home page session is " + home);
    if (r.partner !== A2) throw new Error("partner is " + r.partner);
    return `"${asked}"; home page sub=${home}, created by ${r.partner}; ${await expectSub(a, A)} on the exchange`;
});

const b = await person("B");
await signUp(b, B);

await step(a, `asks to make ${B} the recovery partner`, async (page) => {
    await manage(page, A); await page.click(".si-tab >> text=Security");
    await page.fill(".si-input", B);
    await page.click("text=Change recovery partner");
    await until("pending partner change", async () => { const r = await record(a, A); return r.pending && r.pending.partner === B; });
    await page.waitForSelector("#mg-notice:not([hidden])");
    await snap(a, "partner-requested");
    return (await page.textContent("#mg-notice")).slice(0, 90);
});

await step(b, "the current partner is the sign-up service; it approves after a provider sign-in", async () => {
    const page = a.page; current = a;
    await page.waitForSelector("text=Approve now", { timeout: 30000 });
    await page.click("text=Approve now");
    await page.waitForSelector("#acct-providers button", { timeout: 30000 });
    await page.click("#acct-providers button >> nth=0");
    await provider(page, A);
    await until("partner is B", async () => (await record(a, A)).partner === B, 60000);
    return "partner=" + (await record(a, A)).partner;
});

await step(a, `asks to change the partner again, which now waits for ${B}`, async (page) => {
    await onApp(page).catch(() => {});
    await manage(page, A); await page.click(".si-tab >> text=Security");
    await page.fill(".si-input", "signupsvc");
    await page.click("text=Change recovery partner");
    await until("pending partner change", async () => { const r = await record(a, A); return r.pending && r.pending.partner === "signupsvc"; });
});

await step(b, "recovery page lists the account and the request; approve it by hand", async (page) => {
    await page.goto(`${S}://supervisor.${root}/sign-in.html?app=homepage&path=/recovery`);
    await page.click(`text=Continue as ${B}`);
    await page.waitForURL((u) => u.pathname === "/recovery", { timeout: 60000 });
    await page.waitForSelector(`text=${A}`, { timeout: 60000 });
    await page.waitForSelector("text=Approve", { timeout: 30000 });
    await snap(b, "recovery-page");
    const text = (await page.innerText("body")).replace(/\s+/g, " ").slice(0, 260);
    await page.click("button:has-text('Approve')");
    await until("partner back to sign-up service", async () => (await record(b, A)).partner === "signupsvc", 60000);
    await snap(b, "recovery-approved");
    return text;
});

for (const p of [a, b]) for (const l of [...new Set(p.log.filter((l) => !l.includes("404")))].slice(-12)) console.log("     " + l);
await browser.close();
