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
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1000 }, colorScheme: "dark" });
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


import fs from "node:fs";
import { execFileSync } from "node:child_process";
const a = await person("A");
await signUp(a, A);
const keyFile = `/tmp/pw-signin/export/${A}.active.pem`;
const wifFile = `/tmp/pw-signin/export/${A}.active.wif`;
fs.mkdirSync("/tmp/pw-signin/export", { recursive: true });
const cli = (args) => { try { return execFileSync("/tmp/gate-chain/psibase-sock", [args[0], "-a", "http://psibase.localhost/", ...args.slice(1)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return "FAILED: " + (e.stderr || e.message).trim().split("\n").slice(-2).join(" | "); } };
const actions = (bio) => { const f = `/tmp/pw-signin/export/${A}-actions.json`; fs.writeFileSync(f, JSON.stringify([{ sender: A, service: "profiles", method: "setProfile", data: { display_name: "Exported " + A, bio } }])); return f; };
const profile = async () => { const r = await a.context.request.post(`${S}://profiles.${root}/graphql`, { headers: { "Content-Type": "application/graphql" }, data: `{ profile(account: "${A}") { displayName bio } }` }); return JSON.stringify((await r.json()).data); };

await step(a, "export the signing key from the Account tab", async (page) => {
    a.log.length = 0;
    await manage(page, A);
    await page.click("text=Export signing key");
    await page.waitForSelector("#export-wif", { timeout: 30000 });
    await snap(a, "export");
    const wif = (await page.textContent("#export-wif")).trim();
    if (!/^[KL][1-9A-HJ-NP-Za-km-z]{51}$/.test(wif)) throw new Error("not a base58 key: " + wif.slice(0, 6));
    fs.writeFileSync(wifFile, wif + "\n");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("text=Download as a key file")]);
    await download.saveAs(keyFile);
    const pem = fs.readFileSync(keyFile, "utf8");
    const prompts = a.log.filter((l) => l.includes("PASSKEY_PROMPT")).length;
    const stored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)).includes("BEGIN PRIVATE KEY"));
    await page.click("text=Done");
    await page.waitForSelector("text=Sign out other devices");
    return `${download.suggestedFilename()}, ${pem.split("\n")[0]}, ${pem.length} bytes; passkey prompts ${prompts}; key left in page storage: ${stored}`;
});

await step(a, "the command-line tool signs a transaction as the account with the exported key", async () => {
    const out = cli(["push", "-s", keyFile, actions("set from the command line")]);
    if (out.startsWith("FAILED")) throw new Error(out);
    await new Promise((r) => setTimeout(r, 2500));
    const p = await profile();
    if (!p.includes("set from the command line")) throw new Error("profile is " + p);
    return p;
});

await step(a, "the command-line tool also signs with the base58 key, from a file and as text", async () => {
    const one = cli(["push", "-s", wifFile, actions("signed with the base58 key file")]);
    if (one.startsWith("FAILED")) throw new Error(one);
    const two = cli(["push", "-s", fs.readFileSync(wifFile, "utf8").trim(), actions("signed with the base58 key text")]);
    if (two.startsWith("FAILED")) throw new Error(two);
    await new Promise((r) => setTimeout(r, 2500));
    const p = await profile();
    if (!p.includes("base58 key text")) throw new Error("profile is " + p);
    return p;
});

await step(a, "the exported key cannot do an owner action", async () => {
    const f = `/tmp/pw-signin/export/${A}-owner.json`;
    fs.writeFileSync(f, JSON.stringify([{ sender: A, service: "auth-sig", method: "pause", data: {} }]));
    const out = cli(["push", "-s", keyFile, f]);
    if (!out.startsWith("FAILED")) throw new Error("pause was accepted with the active key");
    return out.slice(0, 160);
});

await step(a, "after Sign out other devices the exported key no longer works", async (page) => {
    await manage(page, A);
    await page.click("text=Sign out other devices");
    await page.waitForSelector("#mg-notice:not([hidden])", { timeout: 60000 });
    const out = cli(["push", "-s", keyFile, actions("should not be applied")]);
    if (!out.startsWith("FAILED")) throw new Error("the old key still signs");
    return out.slice(0, 160);
});
await browser.close();
