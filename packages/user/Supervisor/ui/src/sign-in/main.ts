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
import { NAME_RULE, type PageContext, type View } from "./context";
import {
    type Network,
    choiceFor,
    clearDevice,
    forgetAccount,
    heldAccounts,
    logoutFor,
    rememberChoice,
    loadDevice,
    loginFor,
    notePasskey,
    notesToWrite,
    syncAccounts,
} from "./device";
import {
    Cancelled,
    type PasskeyLabel,
    type PrfResult,
    Unsupported,
    type Unlocked,
    canDiscardPasskey,
    canLookUpSilently,
    createPasskey,
    fetchChainId,
    onPasskeyWithoutSecret,
    discardPasskey,
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

const views: View[] = ["welcome", "pick", "fallback", "account", "manage", "working", "done", "unsupported"];

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

// Who the remembered passkey belongs to, kept after signing out so the
// welcome can say whom it is welcoming back. Names only; nothing secret.
const WHO_KEY = "psibase.passkey-holder.v1";

interface Holder {
    /** The account (or the name picked for one) this app would be entered as. */
    name?: string;
    displayName?: string;
    /** How many accounts the passkey holds. */
    accounts?: number;
}

const currentHolder = (): Holder => {
    const device = loadDevice();
    // The account this app knows, or the only account there is. With
    // several and no choice yet, no one account stands for the holder.
    const held = heldAccounts();
    const name =
        choiceFor(destination.app) ||
        (held.length === 1 ? held[0] : undefined) ||
        (held.length === 0 ? device.pendingName : undefined);
    if (name || device.displayName || held.length) {
        return { name, displayName: device.displayName, accounts: held.length };
    }
    try {
        return JSON.parse(window.localStorage.getItem(WHO_KEY) ?? "{}") as Holder;
    } catch {
        return {};
    }
};

const rememberHolder = () => {
    const holder = currentHolder();
    if (holder.name || holder.displayName) {
        window.localStorage.setItem(WHO_KEY, JSON.stringify(holder));
    }
};

const forgetPasskeyHint = () => {
    window.localStorage.removeItem(HAS_PASSKEY_KEY);
    window.localStorage.removeItem(WHO_KEY);
};

const renderWelcome = () => {
    $("network").textContent = rootName;
    document.title = `Welcome · ${rootName}`;

    const knownPasskey = !!window.localStorage.getItem(HAS_PASSKEY_KEY);
    const holder = knownPasskey ? currentHolder() : {};
    const greeting = holder.displayName ?? holder.name;
    $("headline").textContent = !knownPasskey
        ? "Welcome"
        : greeting
          ? `Welcome back, ${greeting}`
          : "Welcome back";
    $("lede").textContent = !knownPasskey
        ? "One passkey gets you in. New here? It takes a few seconds, and you can explore before you decide on anything else."
        : holder.name
          ? `Use your passkey to continue as ${holder.name}.`
          : (holder.accounts ?? 0) > 1
            ? "Use your passkey, then choose which account to use here or create a new one."
            : "Use your passkey to pick up where you left off.";
    setButton(
        !knownPasskey
            ? "Sign up or sign in"
            : holder.name
              ? `Continue as ${holder.name}`
              : "Continue with your passkey",
    );
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
    } else if (knownPasskey) {
        // Someone else at this browser, or another of the visitor's passkeys.
        setBelow(greeting ? `Not ${greeting}?` : "Not your passkey?", {
            label: "Use a different passkey",
            run: () => {
                forgetPasskeyHint();
                nextMode = "auto";
                renderWelcome();
            },
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
    // Each app drops its own session, and with it the network-wide
    // identity that usage is counted under. The destination is included so
    // that identity goes even if no app was entered from this page.
    const hosts = new Set([...apps.filter((app) => ACCOUNT_NAME.test(app)), destination.app]);
    await Promise.allSettled(
        [...hosts].map(async (app) =>
            fetch(`${await resolveAppOrigin(app)}/common/end-session`, {
                method: "POST",
                credentials: "include",
            }),
        ),
    );
    // The active keys leave the supervisor's key store too; the passkey
    // brings them back at the next sign-in.
    for (const account of loadDevice().accounts) {
        await forgetAccount(account.name).catch((e) => console.warn(e));
    }
    window.localStorage.removeItem(APPS_KEY);
    rememberHolder();
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
    const before = choiceFor(destination.app);
    if (account && !signedIn) await loginFor(destination.app, account);
    // Entering as a guest an app that knew an account: the account leaves.
    if (!account && before) await logoutFor(destination.app).catch((e) => console.warn(e));
    rememberChoice(destination.app, account);
    await submitSession(session, !!account);
};

const goToDestination = async (session: GuestSession, celebrate: boolean) => {
    // An app is entered as the account chosen for it. A visitor with
    // accounts who has not chosen for this app is asked, so an app never
    // learns of an account the visitor uses elsewhere.
    const choice = choiceFor(destination.app);
    if (choice === undefined && heldAccounts().length) {
        go("account");
        return;
    }
    const account = choice || undefined;
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
        // The account could not be signed in (paused, frozen, its key was
        // replaced elsewhere, or the network refused). Say so and let the
        // visitor choose. Entering as a guest here would also record "guest"
        // as their choice for this app, and the account would then seem to
        // be ignored on every later visit.
        console.warn(e);
        if (account) {
            go("account", { failed: account });
            return;
        }
        throw e;
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

// A new passkey is made under the name its holder picked, so the password
// manager shows something they recognise. Until they have picked, making one
// stops here and the name is asked for.
let chosenLabel: (PasskeyLabel & { account: string; display?: string }) | undefined;

class NeedsName extends Error {}

const newPasskey = () => {
    if (!chosenLabel) throw new NeedsName();
    working("Creating your passkey", "Follow the prompt from your device.");
    return createPasskey(rootName, chosenLabel, () =>
        working("One more touch", "Confirm once more to finish setting up."),
    );
};

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
    if (mode === "create") return newPasskey();
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

// ------------------------------------------ passkeys that give no secret
//
// Some passkey providers sign but derive no secret (fallback.ts). The page
// then keeps a recovery key in the password manager and asks for it at each
// sign-in. These are the two screens for that.

const fallbackShow = (mode: "keep" | "ask") => {
    $("fb-keep").hidden = mode !== "keep";
    $("fb-ask").hidden = mode !== "ask";
    $("fb-title").textContent =
        mode === "keep" ? "Save your recovery key" : "Enter your recovery key";
    $("fb-lede").textContent =
        mode === "keep"
            ? "Your passkey provider can't derive a secret for this network, so your keys are made from the passkey together with this recovery key. Keep it in your password manager: you need both to sign in. Anyone who has it and can use your passkey controls your accounts."
            : `This passkey can't derive a secret by itself, so it works together with a recovery key. This site made that key when the passkey was created and offered it to your password manager: look there for the entry for ${window.location.hostname} under your name. It is 52 characters and starts with K or L.`;
    show("fallback");
};

onPasskeyWithoutSecret(async (evidence) => {
    const { secretWithoutPrf } = await import("./fallback");
    return secretWithoutPrf(evidence, {
        keep: ({ wif }) =>
            new Promise<void>((resolve) => {
                $("fb-key").textContent = wif;
                const kept = $<HTMLButtonElement>("fb-kept");
                const copy = $<HTMLButtonElement>("fb-copy");
                copy.textContent = "Copy the recovery key";
                copy.onclick = () =>
                    void navigator.clipboard.writeText(wif).then(
                        () => (copy.textContent = "Copied"),
                        () => (copy.textContent = "Could not copy"),
                    );
                kept.onclick = () => {
                    $("fb-key").textContent = "";
                    working("Signing you in", "Deriving your keys on this device.");
                    resolve();
                };
                fallbackShow("keep");
            }),
        ask: () =>
            new Promise<string>((resolve, reject) => {
                const form = $<HTMLFormElement>("fb-form");
                const input = $<HTMLInputElement>("fb-input");
                input.value = "";
                form.onsubmit = (e) => {
                    e.preventDefault();
                    const text = input.value;
                    input.value = "";
                    working("Signing you in", "Deriving your keys on this device.");
                    resolve(text);
                };
                $("fb-cancel").onclick = () => reject(new Cancelled());
                fallbackShow("ask");
                input.focus();
            }),
    });
});

// ------------------------------------------------------- picking a name

let pickTimer: number | undefined;
let pickSeq = 0;

const pickHint = (text: string, bad = false) => {
    const hint = $("pick-hint");
    hint.textContent = text;
    hint.classList.toggle("si-bad", bad);
};

/** Checks the name as it is typed: its shape here, whether it is free on the node. */
const validatePick = () => {
    const input = $<HTMLInputElement>("pick-name");
    const cleaned = input.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (cleaned !== input.value) input.value = cleaned;
    const value = input.value;
    const button = $<HTMLButtonElement>("pick-create");
    button.disabled = true;
    window.clearTimeout(pickTimer);
    const seq = ++pickSeq;
    if (!value) {
        pickHint("8 to 10 lowercase letters, digits or hyphens, starting with a letter.");
        return;
    }
    if (!NAME_RULE.test(value) || value.endsWith("-")) {
        const short = value.length < 8;
        pickHint(
            short
                ? `${8 - value.length} more character${value.length === 7 ? "" : "s"} needed.`
                : "Use lowercase letters, digits and hyphens, starting with a letter.",
            !short,
        );
        return;
    }
    pickHint("Checking…");
    pickTimer = window.setTimeout(async () => {
        try {
            const res = await fetch(
                `${siblingOrigin("x-signup")}/check_name?name=${encodeURIComponent(value)}`,
            );
            const reply = (await res.json()) as { ok?: boolean; problem?: string };
            if (seq !== pickSeq) return;
            pickHint(
                reply.ok ? `${value} is available.` : (reply.problem ?? "That name can't be used."),
                !reply.ok,
            );
            button.disabled = !reply.ok;
        } catch {
            if (seq !== pickSeq) return;
            // The name is confirmed again when the account is created.
            pickHint("Could not check that name just now; you can still continue.");
            button.disabled = false;
        }
    }, 250);
};

const showPick = () => {
    show("pick");
    validatePick();
    $<HTMLInputElement>("pick-name").focus();
};

const wirePick = () => {
    $("pick-name").addEventListener("input", validatePick);
    $("pick-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const account = $<HTMLInputElement>("pick-name").value;
        const display = $<HTMLInputElement>("pick-display").value.trim().slice(0, 40);
        if ($<HTMLButtonElement>("pick-create").disabled) return;
        chosenLabel = {
            account,
            display: display || undefined,
            name: account,
            displayName: display || account,
        };
        void signIn("create");
    });
    $("pick-existing").addEventListener("click", () => void signIn("existing"));
    $("pick-back").addEventListener("click", () => renderWelcome());
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
        notePasskey({
            userId: unlocked.userId,
            displayName: chosenLabel?.display,
            pendingName: chosenLabel?.account,
        });
        // The passkey says which accounts are this visitor's; bring their
        // signing keys to this browser while the root is at hand.
        try {
            await syncAccounts(network(session), unlocked);
        } catch (e) {
            console.warn("Could not bring accounts to this browser", e);
        }
        unlocked.wipe();
        rememberHolder();
        if (accountStep) {
            // Signed in on the way to an account step: carry on there,
            // without a message left in the address by an earlier attempt.
            const kept = new URLSearchParams(window.location.search);
            kept.delete("failed");
            window.location.replace(`${window.location.pathname}?${kept}`);
            return;
        }
        await goToDestination(session, true);
    } catch (e) {
        unlocked?.wipe();
        if (e instanceof NeedsName) {
            showPick();
            return;
        }
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
        // The welcome already offers a different passkey to someone who
        // backed out of this one.
        if (e instanceof Cancelled && loadRememberedCredential()) return;
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
    unlock: async (why, detail, adding) => {
        working(why, detail);
        const unlocked = await unlockWith(
            await readPasskey(
                loadRememberedCredential(),
                false,
                adding ? notesToWrite(adding) : undefined,
            ),
        );
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

// Which network this browser's sign-in data belongs to. Accounts, the
// account chosen for each app and the session are facts about one chain. A
// node that is started again on a new chain keeps its address, so what this
// browser remembered would otherwise be offered for accounts that no longer
// exist.
const NETWORK_KEY = "psibase.network.v1";

let networkChanged = false;

const forgetOtherNetwork = async () => {
    let id: string;
    try {
        id = Array.from(await fetchChainId(), (b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
        return; // The node is unreachable; nothing to compare.
    }
    const known = window.localStorage.getItem(NETWORK_KEY);
    // A browser that has data but no record of its network is one that
    // last signed in before this check existed; it starts clean too.
    networkChanged = known !== null && known !== id;
    if (known !== id) {
        // The passkey itself (HAS_PASSKEY_KEY) is kept: it still works, and
        // derives new keys for the new network.
        clearDevice();
        clearGuestSession();
        window.localStorage.removeItem(WHO_KEY);
        window.localStorage.removeItem(APPS_KEY);
        window.localStorage.setItem(NETWORK_KEY, id);
    }
};

const start = async () => {
    $("network").textContent = rootName;
    // The network's name is the way home from any step of this page.
    $<HTMLAnchorElement>("network").href = `${window.location.protocol}//${root}/`;
    await forgetOtherNetwork();
    // The manage step has more to show than a sign-in card holds.
    if (step === "manage") document.body.dataset.layout = "wide";

    if (!window.PublicKeyCredential || !navigator.credentials) {
        $("unsupported-detail").textContent =
            "Signing in here uses a passkey, and this browser doesn't offer them.";
        show("unsupported");
        return;
    }

    wirePick();
    $("btn-create").addEventListener("click", () => {
        const mode = nextMode;
        nextMode = "auto";
        void signIn(mode);
    });

    // Find where the app is served today before doing anything for it. A
    // name can redirect: the home page is served from the network name's
    // host (which the supervisor's plugins know as "homepage"), and a
    // renamed network or a moved app leaves its old name redirecting to the
    // new one. Signing an account in to a name that only redirects fails,
    // because a browser does not follow a redirect on a cross-origin
    // preflight.
    if (destination.explicit) {
        const label = (origin: string) => new URL(origin).host.split(".")[0];
        const home = label(await resolveAppOrigin("homepage"));
        const served = label(await resolveAppOrigin(destination.app));
        if (served === home) destination.app = "homepage";
        else if (ACCOUNT_NAME.test(served)) destination.app = served;
    }

    const session = loadGuestSession();
    const forget = $("btn-forget");
    forget.addEventListener("click", async () => {
        working("Signing out");
        const unused = loadDevice().accounts.length === 0;
        const credentialId = window.localStorage.getItem(HAS_PASSKEY_KEY);
        await signOutEverywhere();
        forget.hidden = true;
        $("foot-id").textContent = "";
        renderWelcome();
        // A passkey that never became an account is only clutter in the
        // password manager; offer to take it out.
        if (unused && credentialId && canDiscardPasskey()) {
            setBelow("Signed out. This passkey has no accounts.", {
                label: "Remove it from your password manager",
                run: async () => {
                    await discardPasskey(credentialId);
                    forgetPasskeyHint();
                    renderWelcome();
                    setBelow("Removed.");
                },
            });
        }
    });

    // "intent=guest": an app's Log out. The account leaves this app, and the
    // visitor stays in it as a guest, so the app is not asked again which
    // account to use.
    if (query.get("intent") === "guest") {
        working("Signing out", `of ${destination.app}.${rootName}`);
        await logoutFor(destination.app).catch((e) => console.warn(e));
        if (session) {
            await enterApp(session, undefined);
        } else {
            window.location.assign(
                (await resolveAppOrigin(destination.app)) + destination.path,
            );
        }
        return;
    }

    if (session) {
        const device = loadDevice();
        const who = device.current ?? `Guest ${shortId(session.guest)}`;
        $("foot-id").textContent = device.displayName ? `${device.displayName} · ${who}` : who;
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
    if (networkChanged) {
        setNotice(
            "This network was started afresh since you were last here. Your passkey still works; accounts you had before need to be created again.",
        );
    }
};

void start();
