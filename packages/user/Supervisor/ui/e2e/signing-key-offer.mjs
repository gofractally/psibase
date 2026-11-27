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


import fs from "node:fs";
import { execFileSync } from "node:child_process";
const dir = "/tmp/pw-signin/adopt"; fs.mkdirSync(dir, { recursive: true });
const cli = (args) => { try { return execFileSync("/tmp/gate-chain/psibase-sock", [args[0], "-a", "http://psibase.localhost/", ...args.slice(1)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return "FAILED: " + (e.stderr || e.message).trim().split("\n").slice(-2).join(" | "); } };
const T = B;   // the existing account, held by a key file
execFileSync("openssl", ["genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:secp256k1", "-out", `${dir}/${T}.pem`]);
execFileSync("openssl", ["pkey", "-in", `${dir}/${T}.pem`, "-pubout", "-out", `${dir}/${T}.pub`]);
console.log("create:", cli(["create", "-k", `${dir}/${T}.pub`, T]).trim().split("\n").pop().slice(0, 120));
const a = await person("A");
await step(a, "a visitor signs in with a passkey", async (page) => {
    await page.goto(`${S}://${app}.${root}/`);
    await page.waitForSelector("#view-welcome:not([hidden])");
    await page.click("#btn-create");
    await page.waitForSelector("#view-pick:not([hidden])", { timeout: 30000 });
    await page.fill("#pick-name", A); await page.waitForSelector("#pick-create:not([disabled])"); await page.click("#pick-create");
    await onApp(page);
});
let file;
await step(a, "asks for the existing account and is offered a signing key for its owner to install", async (page) => {
    await page.goto(`${S}://supervisor.${root}/sign-in.html?step=account&intent=recover&app=${app}&path=/`);
    await page.waitForSelector("#acct-name-form:not([hidden])", { timeout: 30000 });
    await page.fill("#acct-name", T); await page.waitForSelector("#acct-create:not([disabled])"); await page.click("#acct-create");
    await page.waitForSelector("text=is controlled by another key", { timeout: 60000 });
    await snap(a, "key-offer");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#acct-list button >> nth=0")]);
    file = `${dir}/${download.suggestedFilename()}`; await download.saveAs(file);
    const json = fs.readFileSync(file, "utf8");
    if (json.includes("PRIVATE")) throw new Error("the file holds a private key");
    return `${download.suggestedFilename()}; command: ${await page.textContent(".si-code")}`;
});
await step(a, "the owner sends it with the key file, and the passkey can sign in as the account", async (page) => {
    const out = cli(["push", "-s", `${dir}/${T}.pem`, file]);
    if (out.startsWith("FAILED")) throw new Error(out);
    await page.click(`text=I've done that`);
    await onApp(page);
    const r = await record(a, T);
    return `${await expectSub(a, T)}; active seq ${r.active.seq}, owner seq ${r.owner.seq}`;
});
await step(a, "the passkey cannot take an owner action on it; the key file still can", async (page) => {
    await manage(page, T);
    await page.click(".si-tab >> text=Security");
    await page.click("text=Pause this account"); await page.click("text=click again to confirm");
    await page.waitForSelector("#mg-notice:not([hidden])", { timeout: 60000 });
    const notice = await page.textContent("#mg-notice");
    const r = await record(a, T);
    if (r.state.toLowerCase() !== "normal") throw new Error("the passkey paused it");
    return notice.slice(0, 110);
});
await browser.close();
