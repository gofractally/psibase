// The network's front door. An app host sends a visitor here when the node
// does not know who they are; the visitor signs in with a passkey and is
// returned to the page they asked for, as a guest or as one of their
// accounts.
//
// This page runs on the supervisor origin, the only origin allowed to use the
// passkey. The passkey secret, the root derived from it and every owner key
// stay in this page for the length of one action: they are never stored,
// never posted, and never handed to an app (gofractally/psibase#2275).
import {
    type GuestSession,
    clearGuestSession,
    loadGuestSession,
    rootHost,
    saveGuestSession,
} from "../guest-session";
import { signText } from "./account-keys";
import { type PageContext, type View } from "./context";
import {
    type Network,
    clearDevice,
    forgetAccount,
    loadDevice,
    loginFor,
    syncAccounts,
} from "./device";
import {
    Cancelled,
    type PrfResult,
    Unsupported,
    type Unlocked,
    canLookUpSilently,
    createPasskey,
    fromB64Url,
    unlockWith,
    readPasskey,
} from "./passkey";

// ---------------------------------------------------------------- helpers

const $ = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;

const root = rootHost();
const rootName = root.replace(/:\d+$/, "");
const siblingOrigin = (service: string) =>
    `${window.location.protocol}//${service}.${root}`;

// ------------------------------------------------------------ destination

// The app and path come from the URL, so they are checked here and nothing
// else is trusted: the app must be a plain service name on this network and
// the path must stay on that app.
const ACCOUNT_NAME = /^[a-z][a-z0-9-]{0,17}$/;

interface Destination {
    app: string;
    path: string;
    /** False when the visitor came straight to the front door. */
    explicit: boolean;
}

const query = new URLSearchParams(window.location.search);

const readDestination = (): Destination => {
    const app = query.get("app");
    const path = query.get("path") ?? "/";
    const pathOk =
        path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");
    if (app && ACCOUNT_NAME.test(app) && app !== "supervisor") {
        return { app, path: pathOk ? path : "/", explicit: true };
    }
    return { app: "homepage", path: "/", explicit: false };
};

const destination = readDestination();

// "step=account": choose, create or recover an account.
// "step=manage": the accounts on this browser and their owner-key actions.
const step = query.get("step");
const accountStep = step === "account" || step === "manage";

const go: PageContext["go"] = (next, extra = {}) => {
    const params = new URLSearchParams({
        step: next,
        ...(destination.explicit ? { app: destination.app, path: destination.path } : {}),
        ...extra,
    });
    window.location.assign(`${window.location.pathname}?${params}`);
};

// ------------------------------------------------------------------ views

const views: View[] = ["welcome", "account", "manage", "working", "done", "unsupported"];

const show = (view: View) => {
    for (const v of views) $(`view-${v}`).hidden = v !== view;
};

const working = (title: string, detail = "") => {
    $("working-title").textContent = title;
    $("working-detail").textContent = detail;
    show("working");
};

const setNotice = (message?: string) => {
    const el = $("notice");
    el.hidden = !message;
    el.textContent = message ?? "";
};

const setButton = (label: string) => {
    $("btn-create-label").textContent = label;
};

/** The line under the button: a sentence and, optionally, one link. */
const setBelow = (text?: string, link?: { label: string; run: () => void }) => {
    const el = $("below");
    el.textContent = text ?? "";
    el.hidden = !text;
    if (text && link) {
        el.append(" ");
        const a = document.createElement("button");
        a.type = "button";
        a.className = "si-link";
        a.textContent = link.label;
        a.addEventListener("click", link.run);
        el.append(a);
    }
};

const shortId = (guest: string) => `${guest.slice(0, 4)}…${guest.slice(-4)}`;

const HAS_PASSKEY_KEY = "psibase.has-passkey.v1";

const renderWelcome = () => {
    $("network").textContent = rootName;
    document.title = `Welcome · ${rootName}`;

    const knownPasskey = !!window.localStorage.getItem(HAS_PASSKEY_KEY);
    $("headline").textContent = knownPasskey ? "Welcome back" : "Welcome";
    $("lede").textContent = knownPasskey
        ? "Use your passkey to pick up where you left off."
        : "One passkey gets you in. New here? It takes a few seconds, and you can explore before you decide on anything else.";
    setButton(knownPasskey ? "Continue with your passkey" : "Sign up or sign in");
    if (accountStep) {
        // Asked to connect an account without being signed in: the passkey
        // comes first, and the older account-and-key prompt stays one
        // click away.
        setBelow("Have an account with a key of its own?", {
            label: "Use it instead",
            run: () =>
                window.location.assign(
                    `/prompt.html?classic=1&returnPath=${encodeURIComponent(destination.path)}`,
                ),
        });
    } else {
        setBelow();
    }

    if (destination.explicit) {
        $("dest-avatar").textContent = destination.app[0].toUpperCase();
        const host = $("dest-host");
        host.textContent = "";
        host.append(destination.app);
        const dim = document.createElement("span");
        dim.className = "si-dim";
        dim.textContent = "." + rootName;
        host.append(dim);
        $("destination").hidden = false;
    }
    show("welcome");
};

// ------------------------------------------------------------------ node

interface GuestLoginReply {
    access_token: string;
    guest: string;
    exp: number;
}

const guestLogin = async (unlocked: Unlocked): Promise<GuestSession> => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const proof = signText(
        `psibase guest login\n${rootName}\n${exp}`,
        unlocked.guest.secret,
    );
    const res = await fetch(`${siblingOrigin("transact")}/guest-login`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({ key: unlocked.guest.publicKey, exp, sig: proof }),
    });
    if (!res.ok) {
        throw new Error("The network did not accept the sign-in. Try again.");
    }
    const reply = (await res.json()) as GuestLoginReply;
    return {
        token: reply.access_token,
        guest: reply.guest,
        exp: reply.exp,
        publicKey: unlocked.guest.publicKey,
        credentialId: unlocked.credentialId,
    };
};

// The apps this browser was given a session for, so signing out can take
// those sessions back.
const APPS_KEY = "psibase.guest-apps.v1";

const rememberApp = (app: string) => {
    const apps = new Set<string>(
        JSON.parse(window.localStorage.getItem(APPS_KEY) ?? "[]"),
    );
    apps.add(app);
    window.localStorage.setItem(APPS_KEY, JSON.stringify([...apps]));
};

/** Ends the session everywhere this browser holds it, and drops its keys. */
const signOutEverywhere = async () => {
    const apps: string[] = JSON.parse(
        window.localStorage.getItem(APPS_KEY) ?? "[]",
    );
    await Promise.allSettled(
        apps
            .filter((app) => ACCOUNT_NAME.test(app))
            .map((app) =>
                fetch(`${siblingOrigin(app)}/common/set-host-cookie`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: "SESSION",
                        value: "",
                        maxAge: 0,
                        httpOnly: true,
                    }),
                }),
            ),
    );
    // The active keys leave the supervisor's key store too; the passkey
    // brings them back at the next sign-in.
    for (const account of loadDevice().accounts) {
        await forgetAccount(account.name).catch((e) => console.warn(e));
    }
    window.localStorage.removeItem(APPS_KEY);
    clearDevice();
    clearGuestSession();
};

// The origin that actually serves an app. Some names are aliases that the
// node redirects (the home page is one), and a browser strips the origin
// from a form post that gets redirected to another host, which the app
// would then refuse. So the redirect is followed here first.
const resolveAppOrigin = async (app: string): Promise<string> => {
    const direct = siblingOrigin(app);
    try {
        const res = await fetch(`${direct}/common/rootdomain`, {
            redirect: "follow",
            // Nothing here is the visitor's; and a redirected reply that
            // allows any origin cannot be read with credentials.
            credentials: "omit",
        });
        const landed = new URL(res.url);
        const parent = (host: string) => host.split(".").slice(1).join(".");
        if (parent(landed.host) === parent(new URL(direct).host)) {
            return landed.origin;
        }
    } catch {
        // Fall through to the name as given.
    }
    return direct;
};

/**
 * Hands the session to the destination app and goes there.
 *
 * This is a top-level form post, not a background request: the app's host
 * sets its own cookie as the page the visitor is navigating to, which every
 * browser keeps, and then sends the visitor on to the page that was asked
 * for. The token travels in the request body, never in a URL.
 *
 * `visitorOnly`: the app already holds an account's session, so only the
 * network-wide identity that usage is counted under is set, and the app's
 * own session is left as it is.
 */
const submitSession = async (session: GuestSession, visitorOnly = false) => {
    rememberApp(destination.app);
    const appOrigin = await resolveAppOrigin(destination.app);
    const maxAge = Math.max(0, session.exp - Math.floor(Date.now() / 1000));
    const form = document.createElement("form");
    form.method = "POST";
    form.action = `${appOrigin}/common/accept-session`;
    form.hidden = true;
    const field = (name: string, value: string) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.append(input);
    };
    field("token", session.token);
    field("path", destination.path);
    field("maxAge", String(maxAge));
    if (visitorOnly) field("visitorOnly", "1");
    document.body.append(form);
    form.submit();
};

/** Whether the node still honours this session. */
const sessionAccepted = async (session: GuestSession): Promise<boolean> => {
    try {
        const res = await fetch(`${siblingOrigin("branding")}/graphql`, {
            method: "POST",
            headers: {
                "Content-Type": "application/graphql",
                Authorization: `Bearer ${session.token}`,
            },
            body: "{ __typename }",
        });
        return res.status !== 401;
    } catch {
        return true;
    }
};

// ------------------------------------------------------------ return leg

// If an app sends the visitor straight back here after we returned them, the
// session is not being accepted. Stop instead of bouncing forever.
const BOUNCE_KEY = `psibase.sign-in.returned.${destination.app}`;
const BOUNCE_WINDOW_MS = 8000;

const returnedRecently = (): boolean => {
    const at = Number(window.sessionStorage.getItem(BOUNCE_KEY) ?? 0);
    return Date.now() - at < BOUNCE_WINDOW_MS;
};

/**
 * Leaves for the destination: as `account` when this browser acts as one,
 * otherwise as a guest.
 */
const enterApp = async (
    session: GuestSession,
    account: string | undefined,
    signedIn = false,
) => {
    window.sessionStorage.setItem(BOUNCE_KEY, String(Date.now()));
    if (account && !signedIn) await loginFor(destination.app, account);
    await submitSession(session, !!account);
};

const goToDestination = async (session: GuestSession, celebrate: boolean) => {
    const device = loadDevice();
    const entry = device.accounts.find((a) => a.name === device.current);
    const account = entry && entry.held !== false ? entry.name : undefined;
    if (celebrate) {
        $("done-detail").textContent = account
            ? `Welcome back, ${account}`
            : destination.explicit
              ? `Taking you to ${destination.app}.${rootName}`
              : "Taking you inside";
        show("done");
        await new Promise((r) => setTimeout(r, 900));
    }
    try {
        await enterApp(session, account);
    } catch (e) {
        // The account could not be signed in (paused, frozen, or its key was
        // replaced elsewhere). The visitor still gets in, as a guest.
        console.warn(e);
        await enterApp(session, undefined);
    }
};

// ------------------------------------------------------------------ flow

const describeFailure = (e: unknown): string | undefined => {
    if (e instanceof Cancelled) return undefined; // The visitor changed their mind.
    if (e instanceof Error && e.message) return e.message;
    return "Something went wrong. Try again.";
};

type Mode = "auto" | "create" | "existing";

const loadRememberedCredential = (): Uint8Array | undefined => {
    const id = window.localStorage.getItem(HAS_PASSKEY_KEY);
    try {
        return id ? fromB64Url(id) : undefined;
    } catch {
        return undefined;
    }
};

const newPasskey = () =>
    createPasskey(rootName, () =>
        working("One more touch", "Confirm once more to finish setting up."),
    );

class NoPasskeyChosen extends Error {}

/**
 * One button signs a visitor up or in.
 *
 * - This browser has signed in before: use that passkey.
 * - The browser can look without a dialog: use a passkey if the device has
 *   one, otherwise create one.
 * - Otherwise ask the browser for an existing passkey first, so a returning
 *   visitor on a new browser is not given a second identity. If none is
 *   chosen, the button becomes "Create a passkey".
 */
const obtainPasskey = async (mode: Mode): Promise<PrfResult> => {
    if (mode === "create") {
        working("Creating your passkey", "Follow the prompt from your device.");
        return newPasskey();
    }
    const remembered = loadRememberedCredential();
    if (remembered || mode === "existing") {
        working("Checking your passkey", "Follow the prompt from your device.");
        return readPasskey(remembered);
    }
    if (await canLookUpSilently()) {
        working("Looking for your passkey");
        try {
            return await readPasskey(undefined, true);
        } catch (e) {
            if (!(e instanceof Cancelled)) throw e;
        }
        working("Creating your passkey", "Follow the prompt from your device.");
        return newPasskey();
    }
    working("Checking for a passkey", "Follow the prompt from your device.");
    try {
        return await readPasskey();
    } catch (e) {
        if (e instanceof Cancelled) throw new NoPasskeyChosen();
        throw e;
    }
};

const network = (session: GuestSession): Network => ({
    siblingOrigin,
    token: session.token,
});

let nextMode: Mode = "auto";

const signIn = async (mode: Mode) => {
    setNotice();
    let unlocked: Unlocked | undefined;
    try {
        const prf = await obtainPasskey(mode);
        working("Signing you in", "Deriving your keys on this device.");
        unlocked = await unlockWith(prf);
        const session = await guestLogin(unlocked);
        saveGuestSession(session);
        window.localStorage.setItem(HAS_PASSKEY_KEY, session.credentialId);
        // The passkey says which accounts are this visitor's; bring their
        // signing keys to this browser while the root is at hand.
        try {
            await syncAccounts(network(session), unlocked, destination.app);
        } catch (e) {
            console.warn("Could not bring accounts to this browser", e);
        }
        unlocked.wipe();
        if (accountStep) {
            // Signed in on the way to an account step: carry on there.
            window.location.reload();
            return;
        }
        await goToDestination(session, true);
    } catch (e) {
        unlocked?.wipe();
        if (e instanceof Unsupported) {
            $("unsupported-detail").textContent = e.message;
            show("unsupported");
            return;
        }
        renderWelcome();
        if (e instanceof NoPasskeyChosen) {
            // The browser found nothing to use, or the visitor closed its
            // dialog. The same button now creates a passkey.
            nextMode = "create";
            setButton("Create a passkey");
            setBelow("No passkey was used. New here? Create one.", {
                label: "Look again",
                run: () => void signIn("existing"),
            });
            return;
        }
        if (e instanceof Cancelled && loadRememberedCredential()) {
            setBelow("Not your passkey?", {
                label: "Use a different one",
                run: () => {
                    window.localStorage.removeItem(HAS_PASSKEY_KEY);
                    nextMode = "auto";
                    renderWelcome();
                },
            });
            return;
        }
        setNotice(describeFailure(e));
    }
};

const pageContext = (session: GuestSession): PageContext => ({
    session,
    app: destination.app,
    path: destination.path,
    rootName,
    net: network(session),
    $,
    show,
    working,
    unlock: async (why, detail) => {
        working(why, detail);
        const unlocked = await unlockWith(await readPasskey(loadRememberedCredential()));
        if (unlocked.guest.publicKey !== session.publicKey) {
            unlocked.wipe();
            throw new Error(
                "That is a different passkey from the one you signed in with.",
            );
        }
        return unlocked;
    },
    enterApp: (account, signedIn) => enterApp(session, account, signedIn),
    isCancelled: (e) => e instanceof Cancelled,
    go,
});

const start = async () => {
    $("network").textContent = rootName;

    if (!window.PublicKeyCredential || !navigator.credentials) {
        $("unsupported-detail").textContent =
            "Signing in here uses a passkey, and this browser doesn't offer them.";
        show("unsupported");
        return;
    }

    $("btn-create").addEventListener("click", () => {
        const mode = nextMode;
        nextMode = "auto";
        void signIn(mode);
    });

    // The home page is served from the network name's host, but the
    // supervisor's plugins know it as "homepage". Whichever name the visitor
    // arrived with, the plugins are given theirs; the hand-off form finds
    // the host again (resolveAppOrigin).
    if (destination.explicit && destination.app !== "homepage") {
        const home = new URL(await resolveAppOrigin("homepage")).host.split(".")[0];
        if (destination.app === home) destination.app = "homepage";
    }

    const session = loadGuestSession();
    const forget = $("btn-forget");
    forget.addEventListener("click", async () => {
        working("Signing out");
        await signOutEverywhere();
        forget.hidden = true;
        $("foot-id").textContent = "";
        renderWelcome();
    });

    if (session) {
        const current = loadDevice().current;
        $("foot-id").textContent = current ?? `Guest ${shortId(session.guest)}`;
        forget.hidden = false;
        if (step === "manage") {
            const { runManageStep } = await import("./manage");
            await runManageStep(pageContext(session));
            return;
        }
        if (step === "account") {
            const { runAccountStep } = await import("./account");
            await runAccountStep(pageContext(session));
            return;
        }
        if (returnedRecently()) {
            // We already sent them back once and the app did not accept it.
            clearGuestSession();
            renderWelcome();
            setNotice(
                window.location.protocol === "http:"
                    ? "This browser did not keep the sign-in for this app. Safari only keeps it over a secure (https) connection; over http, use Chrome."
                    : "Your earlier sign-in is no longer valid here. Use your passkey to continue.",
            );
            return;
        }
        // An app sent the visitor here because the supervisor inside it
        // had no session, although this page has one. Find out which side
        // is wrong before sending them back into the same failure.
        if (query.has("refresh")) {
            const valid = await sessionAccepted(session);
            if (!valid) {
                clearGuestSession();
                forget.hidden = true;
                $("foot-id").textContent = "";
                renderWelcome();
                return;
            }
            renderWelcome();
            setNotice(
                "You are signed in, but this browser keeps apps from seeing it (it isolates each site's storage). Chrome works; in Safari this happens on localhost addresses.",
            );
            return;
        }
        // Already signed in on this browser: no prompt, straight back.
        try {
            working(
                "Welcome back",
                destination.explicit
                    ? `Opening ${destination.app}.${rootName}`
                    : "",
            );
            await goToDestination(session, false);
            return;
        } catch (e) {
            renderWelcome();
            setNotice(describeFailure(e));
            return;
        }
    }

    renderWelcome();
};

void start();
