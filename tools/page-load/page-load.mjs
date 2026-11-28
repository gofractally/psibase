#!/usr/bin/env node
// Page-load baseline for gofractally/psibase#2315 ("every page loads in 2 s").
//
// Signs in once (virtual authenticator, PRF on), then loads every page in
// PAGES cold and warm, N times each, and reports the time from the start of
// navigation to the page's first content that came from the chain, to Largest
// Contentful Paint and to network idle, with request count, bytes and the
// number of sequential request waves. See README.md beside this file.
//
//   node page-load.mjs --target https://psibase.localhost:8553 --commit <node commit>
//
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import tls from "node:tls";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------- options
const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf("--" + name);
    return i < 0 ? fallback : args[i + 1];
};
const flag = (name) => args.includes("--" + name);
if (flag("help")) {
    console.log(fs.readFileSync(path.join(HERE, "README.md"), "utf8"));
    process.exit(0);
}
const target = new URL(opt("target", "https://psibase.localhost:8553"));
const ROOT = target.host; // host[:port]; apps live at <app>.<ROOT>
const LOCAL = /(^|\.)localhost$/.test(target.hostname) || target.hostname === "127.0.0.1";
const REPEATS = Number(opt("repeats", LOCAL ? 5 : 3));
const PROFILES = opt("profile", "desktop").split(",").flatMap((p) => (p === "both" ? ["desktop", "mobile"] : [p]));
// The fixed delay is a property of the *desktop* reference profile on a local
// node. A remote target has its own latency, so nothing is added there.
const DELAY = Number(opt("delay", LOCAL ? 150 : 0));
const DELAY_METHOD = opt("delay-method", "proxy"); // proxy | route
const ONLY = opt("pages", "")
    .split(",")
    .filter(Boolean);
const OUT = opt("out", path.join(HERE, "results"));
const NODE_COMMIT = opt("commit", "unknown");
const ACCOUNT = opt("account", undefined);
const KEY_FILE = opt("key-file", undefined);
const HOME_APP = opt("home-app", LOCAL ? "network" : undefined);
const TIMEOUT = Number(opt("timeout", 90)) * 1000;
const TLS_CERT = opt("tls-cert", path.join(os.homedir(), ".psibase-dev-ca/psibase.localhost.pem"));
const TLS_KEY = opt("tls-key", path.join(os.homedir(), ".psibase-dev-ca/psibase.localhost.key"));
const WAVE_GAP = 60; // ms between request starts that begins a new wave (as profile-waves.mjs)
const IDLE_QUIET = 500; // ms with nothing in flight that counts as network idle
const IDLE_CAP = 15000; // ms after the content marker to wait for idle before giving up

// ---------------------------------------------------------------- profiles
// desktop: a desktop viewport, no CPU throttling, and a fixed delay added to
//   every request that reaches the network (the measure #2315 calls repeatable).
// mobile: "Slow 4G" as Lighthouse 13.6 / Chrome DevTools define it
//   (devtools-frontend front_end/models/trace/lantern/simulation/Constants.ts,
//   mobileSlow4G, read 2026-11-28): RTT 150 ms and 1.6 Mbit/s, which applied at
//   the request level are 150 x 3.75 = 562.5 ms per request, 1.6 x 1024 x 0.9 =
//   1474.56 kbit/s down, 750 x 0.9 = 675 kbit/s up; CPU slowed 4x; the screen
//   Lighthouse emulates for mobile (412 x 823 at 1.75, lighthouse
//   core/config/constants.js). No proxy delay is added on top: the 562.5 ms is
//   the per-request latency.
const PROFILE = {
    desktop: {
        label: `desktop, +${DELAY} ms per request (${DELAY_METHOD}), no CPU throttle`,
        context: { viewport: { width: 1280, height: 1000 } },
        delay: DELAY,
        cpu: 1,
        net: null,
    },
    mobile: {
        label: "mid-tier mobile: Slow 4G (562.5 ms per request, 1474.56 kbit/s down, 675 kbit/s up), CPU 4x, 412x823",
        context: {
            viewport: { width: 412, height: 823 },
            deviceScaleFactor: 1.75,
            isMobile: true,
            hasTouch: true,
            userAgent:
                "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36",
        },
        delay: 0,
        cpu: 4,
        net: { offline: false, latency: 562.5, downloadThroughput: (1474.56 * 1024) / 8, uploadThroughput: (675 * 1024) / 8 },
    },
};

// ---------------------------------------------------------------- pages
// One row per page. `app` is the subdomain; `home` stands for the network's
// home app (HOME_APP: "network" on a local chain).
//
// `marker` is the condition that is true only once the page's first content
// that came from the chain is on screen. It is checked inside the page on
// every DOM change (see inPage below): `selector` must exist (and be visible /
// enabled when asked), its text must match `text`, and `absent` must not match
// the page's text. No app is modified; each marker is something the app
// already renders only after a query has answered. Each accepts both the empty
// and the populated state, so the same table works on a fresh chain and a busy
// one. Where a page has nothing from the chain, `marker` is null and the
// primary number is LCP.
const PAGES = [
    {
        id: "sign-in",
        title: "Sign-in page",
        signedIn: false,
        app: "supervisor",
        path: () => `/sign-in.html?app=${HOME_APP}&path=/`,
        // Not chain content: "form usable". The welcome view is hidden in the
        // HTML and shown by the page's script once it has decided what this
        // browser holds (sign-in/main.ts show("welcome")); the name field in it
        // is then visible and enabled.
        marker: { selector: "#view-welcome:not([hidden]) #start-name", visible: true, enabled: true },
        what: "form usable (name field shown and enabled)",
    },
    {
        id: "redirect",
        title: "Signed-out app visit → sign-in",
        signedIn: false,
        app: "home",
        path: () => "/",
        // The same condition, reached through the node's redirect of a
        // signed-out visit: measured from the start of the navigation to the
        // app, on whatever document the browser ends on.
        marker: { url: "/sign-in\\.html", selector: "#view-welcome:not([hidden]) #start-name", visible: true, enabled: true },
        what: "redirected, sign-in form usable",
    },
    {
        id: "home",
        title: "Home / dashboard",
        signedIn: true,
        app: "home",
        path: () => "/",
        // The first thing on the dashboard that needs the chain: the hero
        // heading (display name, or the account name when no profile is
        // published) is a skeleton until the profile query has answered, then
        // an <h1 title=…> (Homepage components/home/passport-hero.tsx). The
        // network cards and activity lists below it arrive later.
        marker: { selector: "h1[title]" },
        what: "the account's name from its profile (the hero heading); the rest of the dashboard fills in later, see network idle",
    },
    {
        id: "wallet",
        title: "Wallet (tokens)",
        signedIn: true,
        app: "home",
        path: () => "/tokens",
        // The wallet renders "Loading wallet…" until the account's balances
        // have loaded, then the stats row whose first card is "Available"
        // (apps/tokens/layout.tsx, components/wallet-stats.tsx).
        marker: { text: "Available", flags: "i", absent: "Loading wallet" },
        what: "the account's balances (or their empty state)",
    },
    {
        id: "contacts",
        title: "Contacts / profile",
        signedIn: true,
        app: "home",
        path: () => "/contacts",
        // The contact list is kept on the device, not on the chain; it is read
        // through the supervisor and the contacts plugin, the same path chain
        // data takes. "Loading contacts…" is replaced by the list, whose header
        // counts the contacts "· stored locally on this device", or by the
        // empty state "Contacts are stored locally…" (apps/contacts/page.tsx).
        // The public profile beside it comes from the chain, but an
        // unpublished profile renders the same before and after its query.
        marker: { text: "stored locally", absent: "Loading contacts" },
        what: "contact list (device data read through the supervisor; not chain data)",
    },
    {
        id: "mail",
        title: "Mail",
        signedIn: true,
        app: "home",
        path: () => "/chainmail",
        // The conversation list shows skeleton rows while the query is
        // pending, then either rows (each with a time) or "No chats yet"
        // (apps/chainmail/components/conversation-list.tsx).
        marker: { text: "No chats yet|Search chats" },
        what: "conversation list (or its empty state)",
    },
    {
        id: "name-market",
        title: "Name market",
        signedIn: true,
        app: "home",
        path: () => "/account-marketplace",
        // Either "Purchases are disabled" (decided from the system token and
        // can-buy queries) or the buy form, whose price line appears when the
        // markets query has answered (apps/accounts-marketplace/buy-page.tsx).
        marker: { text: "Purchases are disabled|Current price|Price" },
        what: "market state (or 'purchases are disabled')",
    },
    {
        id: "swap",
        title: "Swap",
        signedIn: true,
        app: "home",
        path: () => "/tokens/swap",
        // The pools panel shows skeletons while the pools query is pending,
        // then "No pools yet" or a table headed Pool / Pair / Reserves
        // (apps/token-swap/page.tsx).
        marker: { text: "No pools yet|Reserves", absent: "Loading wallet" },
        what: "liquidity pools (or their empty state)",
    },
    {
        id: "explorer",
        title: "Explorer",
        signedIn: true,
        app: "explorer",
        path: () => "/",
        // The "Head block" card shows "#<height>" once the live chain feed has
        // delivered a head block (Explorer pages/dashboard.tsx).
        marker: { text: "Head block\\s*#[\\d,]+", flags: "i" },
        what: "head block number",
    },
    {
        id: "workshop",
        title: "Workshop",
        signedIn: true,
        app: "workshop",
        path: () => "/",
        // "Add an app to continue" replaces "Login to continue" when the
        // supervisor has answered who is signed in (Workshop pages/loader.tsx);
        // an account that owns apps is sent on to /app/<name> instead.
        marker: { text: "Add an app to continue|Support requests|Settings" },
        what: "signed-in state from the supervisor (the app list is empty on a new account)",
    },
    {
        id: "docs",
        title: "Docs",
        signedIn: true,
        app: "docs",
        path: () => "/",
        marker: null, // a static book; nothing on it comes from the chain
        what: "static page: LCP",
    },
];
// Listed in #2315 but not measured here, with the reason; printed with the table.
const NOT_MEASURED = [
    ["Wallet transfer confirmation prompt", "needs a token balance to reach; a new account on a freshly booted chain has none, and this script sends no transactions"],
    ["Exchange", "not in the DevDefault package set"],
    ["Bitcoin bridge", "not in the DevDefault package set"],
];

// ---------------------------------------------------------------- in-page probe
// Runs at document start in every document of the measured tab. Records, as
// wall-clock times so that a navigation spanning several documents (a
// redirect) is measured on one clock: the first moment the marker condition
// holds, checked in the animation frame after any DOM change; and the latest
// Largest Contentful Paint candidate of the current document.
const inPage = (m) => {
    if (window !== window.top) return;
    const pl = (window.__pl = { marker: null, lcp: null });
    try {
        new PerformanceObserver((list) => {
            for (const e of list.getEntries())
                pl.lcp = {
                    at: performance.timeOrigin + e.startTime,
                    size: e.size,
                    el: e.element ? e.element.tagName.toLowerCase() + ": " + (e.element.textContent || e.url || "").trim().slice(0, 60) : e.url || "",
                };
        }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {}
    if (!m) return;
    const re = m.text ? new RegExp(m.text, m.flags || "") : null;
    const absent = m.absent ? new RegExp(m.absent) : null;
    const url = m.url ? new RegExp(m.url) : null;
    let obs, iv;
    const check = () => {
        if (pl.marker) return true;
        if (url && !url.test(location.href)) return false;
        const root = m.selector ? document.querySelector(m.selector) : document.body;
        if (!root) return false;
        if (m.visible && root.getClientRects().length === 0) return false;
        if (m.enabled && root.disabled) return false;
        if (re && !re.test(root.textContent)) return false;
        if (absent && absent.test(document.body.textContent)) return false;
        pl.marker = Date.now();
        if (obs) obs.disconnect();
        clearInterval(iv);
        if (typeof window.__plMarker === "function") window.__plMarker(pl.marker);
        return true;
    };
    let queued = false;
    obs = new MutationObserver(() => {
        if (queued || pl.marker) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            check();
        });
    });
    obs.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    iv = setInterval(check, 100);
};

// ---------------------------------------------------------------- delay proxy
// The fixed delay, for a local node. A TLS-terminating pass-through on a spare
// loopback port holds every request for DELAY ms before forwarding it to the
// node unchanged; the browser is pointed at it with --host-resolver-rules, so
// URLs, Host headers and cookies are exactly those of the node. Unlike
// context.route (which the earlier profile scripts used, and which makes
// Playwright switch the browser's HTTP cache off), the browser's cache, memory
// cache and workers behave as they do for a user, and only requests that
// really reach the network are delayed.
const startProxy = async (delay, upstreamPort) => {
    const agent = new https.Agent({ keepAlive: true, maxSockets: 256, rejectUnauthorized: false });
    const stats = { requests: 0, bytes: 0 };
    const server = https.createServer({ cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) }, (req, res) => {
        stats.requests++;
        setTimeout(() => {
            const up = https.request({ host: "127.0.0.1", port: upstreamPort, method: req.method, path: req.url, headers: req.headers, agent, setHost: false }, (r) => {
                res.writeHead(r.statusCode, r.statusMessage, r.rawHeaders);
                r.on("data", (c) => (stats.bytes += c.length));
                r.pipe(res);
            });
            up.on("error", () => res.destroy());
            req.pipe(up);
        }, delay);
    });
    server.on("upgrade", (req, socket, head) => {
        setTimeout(() => {
            const up = tls.connect({ host: "127.0.0.1", port: upstreamPort, rejectUnauthorized: false, servername: req.headers.host?.split(":")[0] }, () => {
                let h = `${req.method} ${req.url} HTTP/1.1\r\n`;
                for (let i = 0; i < req.rawHeaders.length; i += 2) h += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
                up.write(h + "\r\n");
                if (head?.length) up.write(head);
                socket.pipe(up).pipe(socket);
            });
            up.on("error", () => socket.destroy());
            socket.on("error", () => up.destroy());
        }, delay);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    return { port: server.address().port, stats, close: () => new Promise((r) => { server.closeAllConnections(); agent.destroy(); server.close(r); }) };
};

// ---------------------------------------------------------------- helpers
const appHost = (app) => `${app === "home" ? HOME_APP : app}.${ROOT}`;
const pageUrl = (p) => `https://${appHost(p.app)}${p.path()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AUTHENTICATOR = { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, hasLargeBlob: true, automaticPresenceSimulation: true };
const addAuthenticator = async (cdp, credentials = []) => {
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: AUTHENTICATOR });
    for (const credential of credentials) await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
    return authenticatorId;
};
const launch = (extra = []) => chromium.launch({ channel: "chromium", headless: true, args: extra });
const median = (xs) => {
    const s = xs.filter((x) => x != null).sort((a, b) => a - b);
    if (!s.length) return null;
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const summary = (loads, key) => {
    const xs = loads.map((l) => l[key]).filter((x) => x != null);
    return xs.length ? { median: median(xs), min: Math.min(...xs), max: Math.max(...xs), n: xs.length, of: loads.length } : { median: null, min: null, max: null, n: 0, of: loads.length };
};
const git = (...a) => {
    try {
        return execFileSync("git", ["-C", HERE, ...a], { encoding: "utf8" }).trim();
    } catch {
        return "unknown";
    }
};

// ---------------------------------------------------------------- sign-in
// Local chain: a new account through the sign-in page, with a passkey on a
// virtual authenticator (PRF on) and the sign-up service's development
// provider (boot-chain.sh turns it on). Then the account enters each app that
// will be measured ("Continue as <name>"), because the session cookie is per
// app. What is carried into the measured contexts is described at coldSeed.
const signIn = async (apps) => {
    const browser = await launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const authenticatorId = await addAuthenticator(cdp);
    let name = ACCOUNT;
    try {
        if (KEY_FILE) {
            // An existing account with a key file (the way psiber-account.mjs signs in). No transaction is sent.
            const pem = fs.readFileSync(KEY_FILE, "utf8");
            await page.goto(`https://${appHost("home")}/`);
            await page.waitForSelector("#start-name", { state: "visible", timeout: 60000 });
            await page.fill("#start-name", name);
            await page.click("#btn-create");
            await page.waitForSelector('#below button:has-text("Sign in with a key file")', { timeout: 60000 });
            await page.click('#below button:has-text("Sign in with a key file")');
            await page.waitForSelector("#import-key", { timeout: 90000 });
            if (!(await page.inputValue("#import-name"))) await page.fill("#import-name", name);
            await page.fill("#import-key", pem);
            await page.click("#import-go");
        } else {
            name ??= "pl" + Date.now().toString(36).slice(-8).replace(/[^a-z0-9]/g, "a");
            await page.goto(`https://${appHost("home")}/`);
            await page.waitForSelector("#view-welcome:not([hidden])", { timeout: 60000 });
            await page.fill("#start-name", name);
            await page.click("#btn-create");
            await page.waitForSelector("#acct-providers button", { timeout: 60000 });
            await page.click("#acct-providers button >> nth=0");
            await page.waitForSelector("#acct-name-form:not([hidden])", { timeout: 60000 });
            await page.waitForSelector("#acct-create:not([disabled])", { timeout: 60000 });
            await page.click("#acct-create");
        }
        await page.waitForURL((u) => u.host === appHost("home"), { timeout: 120000 });
        await page.waitForLoadState("networkidle").catch(() => {});
        for (const app of apps) {
            if (app === "home" || app === HOME_APP || app === "supervisor") continue;
            await page.goto(`https://supervisor.${ROOT}/sign-in.html?app=${app}&path=/`);
            await page.waitForSelector(`text=Continue as ${name}`, { timeout: 60000 });
            await page.click(`text=Continue as ${name}`);
            await page.waitForURL((u) => u.host === appHost(app), { timeout: 60000 });
            await page.waitForLoadState("networkidle").catch(() => {});
        }
        await sleep(1000);
        const state = await context.storageState({ indexedDB: true });
        const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
        const version = browser.version();
        return { name, state, credentials, version };
    } catch (e) {
        const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
        throw new Error(`sign-in failed at ${page.url()}: ${e.message.split("\n")[0]} — page says: ${text}`);
    } finally {
        await browser.close();
    }
};

// What a COLD signed-in context starts with. A new browser context is a new
// profile: empty HTTP cache, empty memory and compiled-code caches, no service
// workers, no Cache Storage. Into it go only
//   - the cookies sign-in produced (the per-app session cookies and the
//     visitor cookie), and
//   - the supervisor origin's localStorage and IndexedDB as sign-in left them
//     (the account list, the passkey session, the device key and the
//     encrypted per-plugin data the supervisor keeps),
// minus `psibase.plugin-graph.v1`, the supervisor's record of which plugins
// each app used last time: that is a product of earlier visits to the app and
// drives the plugin prefetch, so a first visit does not have it.
// Nothing fetched or compiled during sign-in is carried over. (A real user
// who has just signed in has the supervisor's own files and a few plugins in
// the HTTP cache; this cold is colder than that, deliberately.)
const coldSeed = (session) => ({
    cookies: session.state.cookies,
    origins: session.state.origins.map((o) => ({ ...o, localStorage: o.localStorage.filter((l) => l.name !== "psibase.plugin-graph.v1") })),
});

// ---------------------------------------------------------------- one load
const describeRequest = (u, type, method) => {
    const url = new URL(u);
    const svc = url.host.split(".")[0];
    if (type === "Preflight" || method === "OPTIONS") return "preflight:" + svc;
    if (url.pathname.endsWith(".wasm")) return "wasm:" + svc;
    if (url.pathname.includes("graphql")) return "gql:" + svc;
    return (url.pathname.split("/").pop() || svc).slice(0, 24) + "@" + svc;
};

const load = async (context, p, profile, credentials, proxy) => {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    if (credentials) await addAuthenticator(cdp, credentials);
    if (profile.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
    await page.addInitScript(inPage, p.marker);
    let markerAt = null;
    context.__onMarker = (t) => (markerAt ??= t);
    // Requests are taken from the DevTools protocol rather than Playwright's
    // request events: those leave out CORS preflights, and on these pages
    // nearly every query to another service's subdomain is preceded by one.
    const reqs = [];
    const byId = new Map();
    let inFlight = 0,
        lastZero = Date.now();
    const finish = (id, bytes, failed) => {
        const e = byId.get(id);
        if (!e || e.end) return;
        e.end = Date.now();
        e.bytes = bytes ?? 0;
        e.failed = failed;
        if (--inFlight === 0) lastZero = e.end;
    };
    await cdp.send("Network.enable");
    cdp.on("Network.requestWillBeSent", (ev) => {
        if (/^(data|blob|about|chrome)/.test(ev.request.url)) return;
        if (ev.redirectResponse) finish(ev.requestId, ev.redirectResponse.encodedDataLength, false);
        const e = { url: ev.request.url, method: ev.request.method, type: ev.type, start: Date.now() };
        byId.set(ev.requestId, e);
        reqs.push(e);
        inFlight++;
    });
    cdp.on("Network.requestServedFromCache", (ev) => byId.get(ev.requestId) && (byId.get(ev.requestId).cached = true));
    cdp.on("Network.responseReceived", (ev) => {
        const e = byId.get(ev.requestId);
        if (!e) return;
        e.status = ev.response.status;
        if (ev.response.fromDiskCache || ev.response.fromPrefetchCache) e.cached = true;
    });
    cdp.on("Network.loadingFinished", (ev) => finish(ev.requestId, ev.encodedDataLength, false));
    cdp.on("Network.loadingFailed", (ev) => {
        if (byId.get(ev.requestId)) byId.get(ev.requestId).error = ev.errorText;
        finish(ev.requestId, 0, true);
    });
    if (profile.net) await cdp.send("Network.emulateNetworkConditions", profile.net);
    const errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
    page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text().slice(0, 200)));
    let workers = 0;
    page.on("worker", () => workers++);

    const url = pageUrl(p);
    const proxied0 = proxy?.stats.requests;
    const t0 = Date.now();
    lastZero = t0;
    const nav = page.goto(url, { waitUntil: "load", timeout: TIMEOUT }).catch((e) => ({ error: e.message.split("\n")[0] }));
    let note;
    if (p.marker) {
        while (markerAt == null && Date.now() - t0 < TIMEOUT) await sleep(20);
        if (markerAt == null) note = `content marker not seen in ${TIMEOUT / 1000} s (ended at ${page.url().slice(0, 100)})`;
    } else {
        const r = await nav;
        if (r?.error) note = r.error;
    }
    // network idle: nothing in flight for IDLE_QUIET, looked for from the marker (or load) onwards
    const from = Date.now();
    let idleAt = null;
    while (Date.now() - from < IDLE_CAP) {
        if (inFlight === 0 && Date.now() - lastZero >= IDLE_QUIET) {
            idleAt = lastZero;
            break;
        }
        await sleep(25);
    }
    const proxied = proxy ? proxy.stats.requests - proxied0 : undefined;
    await sleep(200);
    const probe = await page.evaluate(() => window.__pl).catch(() => null);
    const end = idleAt ?? Date.now();
    const counted = reqs.filter((x) => x.start <= end);
    // A request answered from the browser's cache is not a round trip and transfers nothing.
    const network = counted.filter((x) => !x.cached);
    const content = markerAt != null ? markerAt - t0 : null;
    const before = network.filter((x) => content == null || x.start - t0 <= content);
    const waves = [];
    let last = -1e9;
    for (const x of before) {
        if (x.start - last > WAVE_GAP) waves.push({ at: x.start - t0, items: [] });
        last = x.start;
        waves[waves.length - 1].items.push(describeRequest(x.url, x.type, x.method));
    }
    for (const w of waves) {
        const c = {};
        for (const i of w.items) c[i] = (c[i] || 0) + 1;
        w.count = w.items.length;
        w.items = Object.entries(c).map(([k, v]) => (v > 1 ? `${k}×${v}` : k));
    }
    await page.close();
    return {
        content,
        lcp: probe?.lcp ? Math.round(probe.lcp.at - t0) : null,
        lcpElement: probe?.lcp?.el,
        idle: idleAt != null ? idleAt - t0 : null,
        requests: network.length,
        cached: counted.length - network.length,
        bytes: network.reduce((a, x) => a + (x.bytes || 0), 0),
        preflights: network.filter((x) => x.type === "Preflight" || x.method === "OPTIONS").length,
        revalidated: network.filter((x) => x.status === 304).length,
        wasm: network.filter((x) => x.method === "GET" && x.url.split("?")[0].endsWith(".wasm")).length,
        requestsBeforeContent: before.length,
        waves: waves.length,
        waveList: waves,
        workers,
        failedRequests: counted.filter((x) => x.failed).map((x) => `${x.method} ${x.url.slice(0, 120)} after ${x.end - x.start} ms: ${x.error}`).slice(0, 10),
        errors: errors.slice(0, 10),
        // self-check: requests that finished sooner than the profile's per-request latency, by kind
        undelayed: network
            .filter((x) => x.end && !x.failed && x.end - x.start < (profile.net?.latency ?? profile.delay) - 5)
            .map((x) => `${x.type} ${x.status} ${x.url.slice(0, 100)} ${x.end - x.start} ms`)
            .slice(0, 8),
        requestsSeenByProxy: proxied, // cross-check of `requests` when the delay proxy is in use
        note,
    };
};

// ---------------------------------------------------------------- run
const pages = PAGES.filter((p) => !ONLY.length || ONLY.includes(p.id));
const meta = {
    issue: "gofractally/psibase#2315",
    target: target.origin,
    kind: LOCAL ? "local node" : "REAL NETWORK (figures vary with the line that day)",
    nodeCommit: NODE_COMMIT,
    scriptCommit: git("rev-parse", "--short", "HEAD"),
    date: new Date().toISOString(),
    machine: `${os.cpus()[0]?.model}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB, ${os.type()} ${os.release()}`,
    loadAverageAtStart: os.loadavg().map((x) => +x.toFixed(1)),
    repeats: REPEATS,
    waveGapMs: WAVE_GAP,
    idleQuietMs: IDLE_QUIET,
};

// Stopping the script (kill <pid>) closes its browser and proxy with it.
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));
// These are wall-clock timings: a busy machine makes them longer and erratic.
const BUSY = os.cpus().length / 2;
if (os.loadavg()[0] > BUSY && !flag("force")) {
    console.error(`load average is ${os.loadavg()[0].toFixed(1)} on ${os.cpus().length} cores: the machine is busy and the figures would not be repeatable. Wait, or pass --force (the output will say so).`);
    process.exit(2);
}

let session = null;
const needSignIn = pages.some((p) => p.signedIn);
if (needSignIn && (LOCAL || (ACCOUNT && KEY_FILE))) {
    console.error(`signing in on ${target.origin} …`);
    session = await signIn([...new Set(pages.filter((p) => p.signedIn).map((p) => p.app))]);
    meta.account = session.name;
    meta.browser = "Chromium " + session.version;
    console.error(`signed in as ${session.name}`);
} else if (needSignIn) {
    console.error("no account: only the signed-out pages are measured (give --account and --key-file for the rest)");
}

const results = [];
for (const profileName of PROFILES) {
    const profile = PROFILE[profileName];
    if (!profile) throw new Error("unknown profile " + profileName);
    let proxy = null,
        launchArgs = [];
    if (profile.delay > 0 && DELAY_METHOD === "proxy") {
        if (!LOCAL) throw new Error("--delay with the proxy method needs a local node (the proxy must hold the node's certificate); use --delay 0 for a remote target");
        proxy = await startProxy(profile.delay, Number(target.port || 443));
        launchArgs = [`--host-resolver-rules=MAP ${target.hostname} 127.0.0.1:${proxy.port}, MAP *.${target.hostname} 127.0.0.1:${proxy.port}`];
    }
    const browser = await launch(launchArgs);
    meta.browser ??= "Chromium " + browser.version();
    const newContext = async (seed) => {
        const context = await browser.newContext({ ...profile.context, ...(seed ? { storageState: seed } : {}) });
        await context.exposeBinding("__plMarker", (_src, t) => context.__onMarker?.(t));
        // The earlier profile scripts' method, kept for comparison: note that
        // Playwright disables the HTTP cache while a route is installed.
        if (profile.delay > 0 && DELAY_METHOD === "route")
            await context.route("**/*", async (route) => {
                await sleep(profile.delay);
                await route.continue();
            });
        return context;
    };
    const rows = [];
    for (const p of pages) {
        if (p.signedIn && !session) {
            rows.push({ id: p.id, title: p.title, skipped: "needs an account" });
            continue;
        }
        const cold = [],
            warm = [];
        for (let i = 0; i < REPEATS; i++) {
            // COLD: a new context (see coldSeed); WARM: the same page again in
            // that context, in a new tab, straight after the cold load went idle.
            const context = await newContext(p.signedIn ? coldSeed(session) : null);
            try {
                cold.push(await load(context, p, profile, p.signedIn ? session.credentials : null, proxy));
                warm.push(await load(context, p, profile, p.signedIn ? session.credentials : null, proxy));
            } finally {
                await context.close();
            }
            const c = cold.at(-1),
                w = warm.at(-1);
            console.error(`${profileName} ${p.id} #${i + 1}: cold content ${c.content ?? "-"} lcp ${c.lcp ?? "-"} idle ${c.idle ?? "-"} req ${c.requests} (${(c.bytes / 1024) | 0} KB) waves ${c.waves} proxy ${c.requestsSeenByProxy ?? '-'} undelayed ${c.undelayed.length}${c.note ? " [" + c.note + "]" : ""} | warm content ${w.content ?? "-"} lcp ${w.lcp ?? "-"} idle ${w.idle ?? "-"} req ${w.requests} cached ${w.cached} waves ${w.waves} proxy ${w.requestsSeenByProxy ?? '-'}${w.note ? " [" + w.note + "]" : ""}`);
        }
        const sum = (loads) => Object.fromEntries(["content", "lcp", "idle", "requests", "preflights", "revalidated", "cached", "bytes", "waves", "requestsBeforeContent", "wasm"].map((k) => [k, summary(loads, k)]));
        rows.push({ id: p.id, title: p.title, url: pageUrl(p), signedIn: p.signedIn, primary: p.marker ? "content" : "lcp", marker: p.marker, what: p.what, cold: { summary: sum(cold), loads: cold }, warm: { summary: sum(warm), loads: warm } });
    }
    await browser.close();
    if (proxy) await proxy.close();
    results.push({ profile: profileName, label: profile.label, delayMs: profile.delay, delayMethod: profile.delay ? DELAY_METHOD : null, cpuSlowdown: profile.cpu, network: profile.net, rows });
}

meta.loadAverageAtEnd = os.loadavg().map((x) => +x.toFixed(1));
meta.busy = Math.max(meta.loadAverageAtStart[0], meta.loadAverageAtEnd[0]) > BUSY;

// ---------------------------------------------------------------- report
const secs = (ms) => (ms == null ? "—" : (ms / 1000).toFixed(2));
const range = (s, f = secs) => (s.median == null ? "—" : `${f(s.median)} (${f(s.min)}–${f(s.max)})${s.n < s.of ? ` [${s.n}/${s.of}]` : ""}`);
const int = (x) => String(Math.round(x));
const kb = (x) => String(Math.round(x / 1024));
let md = `# Page load: ${meta.target} (${meta.kind})\n\n`;
md += `- node commit: \`${meta.nodeCommit}\`; script commit: \`${meta.scriptCommit}\`; date: ${meta.date}\n`;
md += `- machine: ${meta.machine}; load average ${meta.loadAverageAtStart[0]} at start, ${meta.loadAverageAtEnd[0]} at end; ${meta.browser}, headless\n`;
if (meta.busy) md += `- **the machine was busy with other work during this run (load average above ${BUSY} on ${os.cpus().length} cores): treat these figures as upper bounds, not as a reference**\n`;
md += `- ${meta.repeats} cold and ${meta.repeats} warm loads per page; each cell is **median (min–max)**; times in seconds from the start of navigation\n`;
md += `- cold = new browser context holding only the sign-in session; warm = the same page again in that context (README.md has the exact definition)\n\n`;
for (const r of results) {
    md += `## Profile: ${r.label}\n\n`;
    md += `| Page | Cold: first chain content | Cold: LCP | Cold: network idle | Cold: requests / KB / waves | Warm: first chain content | Warm: LCP | Warm: network idle | Warm: requests / KB / waves |\n|---|---|---|---|---|---|---|---|---|\n`;
    for (const row of r.rows) {
        if (row.skipped) {
            md += `| ${row.title} | not measured: ${row.skipped} | | | | | | | |\n`;
            continue;
        }
        const cell = (m) => {
            const s = m.summary;
            const first = row.primary === "content" ? `**${range(s.content)}**` : "none on this page (see LCP)";
            return `${first} | ${row.primary === "lcp" ? `**${range(s.lcp)}**` : range(s.lcp)} | ${range(s.idle)} | ${int(s.requests.median)} / ${kb(s.bytes.median)} / ${int(s.waves.median)}`;
        };
        md += `| ${row.title} | ${cell(row.cold)} | ${cell(row.warm)} |\n`;
    }
    md += `\nWhat "first chain content" is on each page:\n\n`;
    for (const row of r.rows) if (!row.skipped) md += `- ${row.title} (\`${row.url.replace("https://", "")}\`): ${row.what}\n`;
    md += "\n";
    // where the time goes on the three slowest cold pages: the request waves of the median cold load
    const ranked = r.rows
        .filter((row) => !row.skipped)
        .map((row) => ({ row, t: row.cold.summary[row.primary].median }))
        .filter((x) => x.t != null)
        .sort((a, b) => b.t - a.t)
        .slice(0, 3);
    md += `### Three slowest cold loads, wave by wave\n\nEach line is one wave: the time its first request started, how many requests, and what they were (\`wasm:x\` = a plugin or component file of service x, \`gql:x\` = a query to x, otherwise file@service). Taken from the cold load nearest the median.\n\n`;
    for (const { row, t } of ranked) {
        const pick = [...row.cold.loads].filter((l) => l[row.primary] != null).sort((a, b) => Math.abs(a[row.primary] - t) - Math.abs(b[row.primary] - t))[0];
        md += `**${row.title}** — ${secs(pick[row.primary])} s, ${pick.requestsBeforeContent} requests in ${pick.waves} waves before the content (${pick.wasm} .wasm files in the whole load)\n\n\`\`\`\n`;
        for (const w of pick.waveList) md += `@${String(w.at).padStart(6)} ms  ${String(w.count).padStart(3)}  ${w.items.join(" ").slice(0, 260)}\n`;
        md += "```\n\n";
    }
}
if (LOCAL) {
    md += `## Not measured\n\n`;
    for (const [what, why] of NOT_MEASURED) md += `- ${what}: ${why}\n`;
}
fs.mkdirSync(OUT, { recursive: true });
const stamp = `${meta.date.slice(0, 10)}-${target.hostname.replace(/[^a-z0-9]+/gi, "-")}-${NODE_COMMIT}-${PROFILES.join("+")}${opt("tag", "") ? "-" + opt("tag") : ""}`;
fs.writeFileSync(path.join(OUT, stamp + ".json"), JSON.stringify({ meta, notMeasured: LOCAL ? NOT_MEASURED : [], results }, null, 1));
fs.writeFileSync(path.join(OUT, stamp + ".md"), md);
console.log(md);
console.error(`written: ${path.join(OUT, stamp)}.{md,json}`);
