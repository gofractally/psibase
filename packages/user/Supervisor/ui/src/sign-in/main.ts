// The network's front door. An app host sends a visitor here when the node
// does not know who they are; the visitor signs in with a passkey and is
// returned to the page they asked for as one of their accounts. Nobody
// goes on to an app without an account.
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
import { looksLikeWif } from "@psibase/common-lib";

import { signText } from "./account-keys";
import { ANY_NAME_RULE, NAME_RULE, type PageContext, type View } from "./context";
import { dropHeld, holdRoot, sweepHeld, takeHeldRoot } from "./held-root";
import {
    type Network,
    choiceFor,
    clearDevice,
    dropFromDevice,
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

const views: View[] = ["welcome", "fallback", "account", "manage", "working", "done", "unsupported"];

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
type BelowLink = { label: string; run: () => void };

const setBelow = (text?: string, ...links: (BelowLink | undefined)[]) => {
    const el = $("below");
    el.textContent = text ?? "";
    const shown = links.filter((l): l is BelowLink => !!l);
    el.hidden = !text && !shown.length;
    shown.forEach((link, i) => {
        el.append(i ? " · " : text ? " " : "");
        const a = document.createElement("button");
        a.type = "button";
        a.className = "si-link";
        a.textContent = link.label;
        a.addEventListener("click", link.run);
        el.append(a);
    });
};

const HAS_PASSKEY_KEY = "psibase.has-passkey.v1";

// An earlier version of this page kept the holder's name here across a
// sign-out. Nothing writes it now; it is removed wherever it is found.
const WHO_KEY = "psibase.passkey-holder.v1";

interface Holder {
    /** The account (or the name picked for one) this app would be entered as. */
    name?: string;
    displayName?: string;
}

// Who this browser's remembered passkey belongs to, from what the browser
// holds for a session that lapsed without a sign-out.
const currentHolder = (): Holder => {
    const device = loadDevice();
    // The account this app knows, or the only account there is. With
    // several and no choice yet, no one account stands for the holder.
    const held = heldAccounts();
    const name =
        choiceFor(destination.app) ||
        (held.length === 1 ? held[0] : undefined) ||
        (held.length === 0 ? device.pendingName : undefined);
    return { name, displayName: device.displayName };
};

// What the first screen may say about who is here. Browser storage is not
// evidence: it outlives a chain that was started again and accounts that no
// longer exist. So nothing from it is shown or filled in until the chain
// has confirmed it (gofractally/psibase#2316), and this stays empty until
// `verifyRemembered` has done that.
let verifiedHolder: Holder = {};

const forgetPasskeyHint = () => {
    window.localStorage.removeItem(HAS_PASSKEY_KEY);
    window.localStorage.removeItem(WHO_KEY);
};

const renderWelcome = () => {
    $("network").textContent = rootName;
    document.title = `Welcome · ${rootName}`;

    const knownPasskey = !!window.localStorage.getItem(HAS_PASSKEY_KEY);
    const holder = knownPasskey ? verifiedHolder : {};
    const greeting = holder.displayName ?? holder.name;
    $("headline").textContent = greeting ? `Welcome back, ${greeting}` : "Welcome";
    $("lede").textContent =
        "Enter your username. New here? Pick one, and a passkey makes it yours.";
    const name = $<HTMLInputElement>("start-name");
    if (!name.value && holder.name) name.value = holder.name;
    showPasswordField(passkeyNeedsPassword());
    setButton("Sign up or log in");
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
                $<HTMLInputElement>("start-name").value = "";
                renderWelcome();
            },
        });
    } else {
        // A free name gets a new passkey. Someone who wants a further
        // account under a passkey they already have says so here.
        setBelow("", {
            label: "I already have a passkey for this site",
            run: () => {
                nextMode = "existing";
                void signIn("existing");
            },
        });
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
    // Nothing is kept that says who was here: not the name, and not which
    // passkey they used. The next visitor is a stranger, and a new name
    // typed here gets a passkey of its own.
    forgetPasskeyHint();
    clearDevice();
    clearGuestSession();
    await dropHeld();
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
 * Leaves for the destination as `account`. Nobody enters an app without an
 * account: a visitor who has only a passkey stays on this page until they
 * have one.
 */
const enterApp = async (
    session: GuestSession,
    account: string | undefined,
    signedIn = false,
) => {
    if (!account) {
        go("account");
        return;
    }
    window.sessionStorage.setItem(BOUNCE_KEY, String(Date.now()));
    if (!signedIn) await loginFor(destination.app, account);
    rememberChoice(destination.app, account);
    await submitSession(session, true);
};

const goToDestination = async (session: GuestSession, celebrate: boolean) => {
    // An app is entered as the account chosen for it. A visitor who has not
    // chosen for this app is asked, so an app never learns of an account
    // the visitor uses elsewhere; one with no account yet goes on to make
    // one.
    const account = choiceFor(destination.app) || undefined;
    if (!account) {
        go("account");
        return;
    }
    if (celebrate) {
        $("done-detail").textContent = `Welcome back, ${account}`;
        show("done");
        await new Promise((r) => setTimeout(r, 900));
    }
    try {
        await enterApp(session, account);
    } catch (e) {
        // The account could not be signed in (paused, frozen, its key was
        // replaced elsewhere, or the network refused). Say so and let the
        // visitor choose.
        console.warn(e);
        go("account", { failed: account });
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

const newPasskey = () => {
    if (!chosenLabel) throw new Error("Enter a username first.");
    working("Creating your passkey", "Follow the prompt from your device.");
    return createPasskey(rootName, chosenLabel, () =>
        working("One more touch", "Confirm once more to finish setting up."),
    );
};

class NoPasskeyChosen extends Error {}

/**
 * One button signs a visitor up or in. `signIn` decides the mode from the
 * name: a name that is an account uses a passkey its holder already has
 * ("existing"); a free name on a browser that remembers no passkey is a new
 * user and gets a new passkey ("create").
 *
 * What is left for "auto" here is a browser that remembers a passkey (its
 * session lapsed; it was not signed out), which uses that passkey, and the
 * callers that take over an account by recovery or a key file:
 *
 * - The browser can look without a dialog: use a passkey if the device has
 *   one, otherwise create one.
 * - Otherwise ask the browser for an existing passkey first. If none is
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
        mode === "keep"
            ? "Please confirm that your passkey's password is saved"
            : "Enter your passkey's password";
    $("fb-lede").textContent =
        mode === "keep"
            ? "Your passkey works together with this password: you need both to sign in. Make sure your password manager saves it."
            : `This passkey works together with a password that this site made when the passkey was created. Look in your password manager for the entry for ${window.location.hostname} under your name. It is 52 characters and starts with K or L.`;
    show("fallback");
};

// Password managers decide a form was submitted successfully when, after its
// submit event, the page moves on (a navigation within the document) and the
// fields are gone from view. The page does move on, so it says so; the field
// keeps its value a little longer for managers that read it late.
const submittedToPasswordManager = (field: HTMLInputElement) => {
    window.history.replaceState(window.history.state, "", window.location.href);
    window.setTimeout(() => (field.value = ""), 5000);
};

onPasskeyWithoutSecret(async (evidence) => {
    const { secretWithoutPrf } = await import("./fallback");
    return secretWithoutPrf(evidence, {
        keep: ({ wif, account }) =>
            new Promise<void>((resolve) => {
                const form = $<HTMLFormElement>("fb-keep");
                const key = $<HTMLInputElement>("fb-key");
                const show = $<HTMLButtonElement>("fb-show");
                const copy = $<HTMLButtonElement>("fb-copy");
                $<HTMLInputElement>("fb-keep-name").value = account;
                key.type = "password";
                key.value = wif;
                // Not read-only (some password managers skip read-only
                // fields), but not editable either.
                key.oninput = () => (key.value = wif);
                show.textContent = "Show";
                show.onclick = () => {
                    const hidden = key.type === "password";
                    key.type = hidden ? "text" : "password";
                    show.textContent = hidden ? "Hide" : "Show";
                };
                copy.textContent = "Copy";
                copy.onclick = () =>
                    void navigator.clipboard.writeText(wif).then(
                        () => (copy.textContent = "Copied"),
                        () => (copy.textContent = "Could not copy"),
                    );
                form.onsubmit = (e) => {
                    e.preventDefault();
                    key.type = "password";
                    submittedToPasswordManager(key);
                    working("Signing you in", "Deriving your keys on this device.");
                    resolve();
                };
                fallbackShow("keep");
            }),
        ask: () =>
            new Promise<string>((resolve, reject) => {
                passwordWasUsed = true;
                // What the first screen's field held is a hint: used once,
                // and if it turns out wrong the visible field asks again.
                if (suppliedPassword) {
                    const hint = suppliedPassword;
                    suppliedPassword = undefined;
                    resolve(hint);
                    return;
                }
                const form = $<HTMLFormElement>("fb-form");
                const input = $<HTMLInputElement>("fb-input");
                const name = $<HTMLInputElement>("fb-name");
                const device = loadDevice();
                // Filled in when this device knows it, so a password manager
                // matches its entry and never saves one without a name.
                name.value =
                    wanted?.name ?? device.current ?? device.accounts[0]?.name ?? device.pendingName ?? "";
                input.value = "";
                form.onsubmit = (e) => {
                    e.preventDefault();
                    const text = input.value;
                    submittedToPasswordManager(input);
                    working("Signing you in", "Deriving your keys on this device.");
                    resolve(text);
                };
                $("fb-cancel").onclick = () => reject(new Cancelled());
                fallbackShow("ask");
                (name.value ? input : name).focus();
            }),
    });
});

// ------------------------------------------------------- the first screen

// The name typed on the first screen, and whether an account has it.
let wanted: { name: string; exists: boolean } | undefined;
// What the first screen's password field held, if it looked like a password
// of ours. A hint only: a manager may have filled another name's entry.
let suppliedPassword: string | undefined;
// Whether this sign-in needed the passkey's password (a passkey that gives
// no secret).
let passwordWasUsed = false;

// How the first screen's password field is kept out of sight when this
// device does not know that the passkey needs one. Managers differ in which
// of these they still fill ("opacity", "tiny", "clip", "offscreen"); change
// it here.
const UNSEEN_FIELD = "opacity";

const showPasswordField = (visible: boolean) => {
    const wrap = $("start-pass-wrap");
    const input = $<HTMLInputElement>("start-pass");
    if (visible) {
        delete wrap.dataset.unseen;
        input.tabIndex = 0;
        input.removeAttribute("aria-hidden");
    } else {
        wrap.dataset.unseen = UNSEEN_FIELD;
        // Out of the tab order and unannounced. If a manager turns out to
        // skip a field for either of these, they go before the trick does.
        input.tabIndex = -1;
        input.setAttribute("aria-hidden", "true");
    }
};

/** Whether this device has used a passkey here that works with a password. */
const passkeyNeedsPassword = (): boolean => {
    const id = loadRememberedCredential();
    if (!id) return false;
    try {
        const hints = JSON.parse(
            window.localStorage.getItem("psibase.passkey-fallback.v1") ?? "{}",
        ) as Record<string, unknown>;
        return Array.from(id, (b) => b.toString(16).padStart(2, "0")).join("") in hints;
    } catch {
        return false;
    }
};

/** Whether an account of this name exists, and if not whether it could be made. */
const lookUpName = async (
    name: string,
): Promise<{ exists: boolean; problem?: string }> => {
    const res = await fetch(
        `${siblingOrigin("x-signup")}/check_name?name=${encodeURIComponent(name)}`,
    );
    if (!res.ok) throw new Error("Could not reach the network. Try again.");
    const reply = (await res.json()) as { ok?: boolean; problem?: string; taken?: boolean };
    // A node that does not say `taken` yet says it in words.
    const exists = reply.taken ?? reply.problem === "That name is taken.";
    return { exists, problem: reply.ok || exists ? undefined : reply.problem };
};

/** Reads the first screen. Nothing (and a notice) when it cannot go on. */
const readStart = async (): Promise<{ name: string; exists: boolean } | undefined> => {
    const input = $<HTMLInputElement>("start-name");
    const name = input.value.trim().toLowerCase().replace(/^@/, "");
    input.value = name;
    if (!name) {
        setNotice("Enter a username.");
        input.focus();
        return undefined;
    }
    if (!ANY_NAME_RULE.test(name)) {
        setNotice("A username is lowercase letters, digits and hyphens, starting with a letter.");
        return undefined;
    }
    working("Checking that name");
    const found = await lookUpName(name);
    if (!found.exists && (found.problem || !NAME_RULE.test(name) || name.endsWith("-"))) {
        renderWelcome();
        setNotice(
            `There is no account called ${name}. ` +
                (found.problem ??
                    "A new name needs 8 to 10 lowercase letters, digits or hyphens, starting with a letter."),
        );
        return undefined;
    }
    const typed = $<HTMLInputElement>("start-pass").value.trim();
    suppliedPassword = looksLikeWif(typed) ? typed : undefined;
    passwordWasUsed = false;
    return { name, exists: found.exists };
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
        const start = await readStart();
        if (!start) return;
        wanted = start;
        const name = start.name;
        // A new passkey is made under the name, so the password manager
        // shows it under something its holder recognises.
        chosenLabel = { account: name, name, displayName: name };
        // An existing account is signed in to with a passkey its holder
        // already has; a passkey is never created for a name that is taken.
        // A free name is a new user: unless this browser remembers a
        // passkey, or the visitor said they have one, a passkey is made
        // for the name without looking for another first (#2316).
        const prf = await obtainPasskey(
            start.exists
                ? "existing"
                : mode === "auto" && !loadRememberedCredential()
                  ? "create"
                  : mode,
        );
        working("Signing you in", "Deriving your keys on this device.");
        unlocked = await unlockWith(prf);
        const session = await guestLogin(unlocked);
        saveGuestSession(session);
        window.localStorage.setItem(HAS_PASSKEY_KEY, session.credentialId);
        notePasskey({ userId: unlocked.userId });
        // The passkey says which accounts are this visitor's; bring their
        // signing keys to this browser while the root is at hand.
        try {
            await syncAccounts(network(session), unlocked);
        } catch (e) {
            console.warn("Could not bring accounts to this browser", e);
        }
        const held = heldAccounts();

        if (held.includes(name) || start.exists) unlocked.wipe();

        if (held.includes(name)) {
            // Theirs: signed in, and this app is entered as it.
            if (accountStep) {
                const kept = new URLSearchParams(window.location.search);
                kept.delete("failed");
                window.location.replace(`${window.location.pathname}?${kept}`);
                return;
            }
            rememberChoice(destination.app, name);
            await goToDestination(session, true);
            return;
        }
        if (start.exists) {
            // An account, but not one these keys open.
            clearGuestSession();
            renderWelcome();
            if (passwordWasUsed) {
                // The password is half of the keys: a wrong one derives
                // keys that match nothing. Ask for it in plain sight.
                showPasswordField(true);
                $<HTMLInputElement>("start-pass").value = "";
                setNotice(
                    `That password does not open ${name} with this passkey. Check the entry for ${name} in your password manager.`,
                );
                return;
            }
            setNotice(`${name} is taken, and this passkey does not control it.`);
            offerOwnAccount(name);
            return;
        }
        // A free name: the next step makes the account. With none yet it is
        // the free account, verified with a provider; with one already, one
        // of their accounts creates it.
        notePasskey({ pendingName: name });
        // What the passkey unlocked is kept for that step (held-root.ts),
        // so the visitor is not asked for it again a page later.
        await holdRoot(unlocked);
        unlocked.wipe();
        // The name goes along, so the next step creates that account
        // instead of asking what to call it.
        go("account", held.length ? { intent: "new", name } : {});
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
            if (wanted?.exists) {
                setNotice(`No passkey was used. ${wanted.name} needs the passkey it was created with.`);
                offerOwnAccount(wanted.name);
                return;
            }
            nextMode = "create";
            setButton("Create a passkey");
            setBelow("No passkey was used. New here? Create one.", {
                label: "Look again",
                run: () => void signIn("existing"),
            });
            return;
        }
        if (e instanceof Cancelled && wanted?.exists) {
            // No passkey was used for a name that is an account: say what
            // it needs, and how someone whose account it is can go on.
            setNotice(`No passkey was used. ${wanted.name} needs the passkey it was created with.`);
            offerOwnAccount(wanted.name);
            return;
        }
        // The welcome already offers a different passkey to someone who
        // backed out of this one.
        if (e instanceof Cancelled && loadRememberedCredential()) return;
        setNotice(describeFailure(e));
    }
};

// The two ways on for someone whose account a name is although no passkey
// of theirs opens it: recover it through its recovery partner, or sign in
// with the account's own key. (Awaiting the owner's word on the wording,
// #2275.) Both need a passkey to bring the account to: the one this browser
// has, or a new one made under that name.
const offerOwnAccount = (name: string) =>
    setBelow(
        "Is it yours?",
        { label: "Recover it", run: () => void takeOverWith(name, "recover") },
        { label: "Sign in with a key file", run: () => void takeOverWith(name, "import") },
    );

const takeOverWith = async (name: string, intent: "recover" | "import") => {
    setNotice();
    let unlocked: Unlocked | undefined;
    try {
        chosenLabel = { account: name, name, displayName: name };
        let prf: PrfResult;
        try {
            prf = await obtainPasskey("auto");
        } catch (e) {
            if (!(e instanceof NoPasskeyChosen)) throw e;
            prf = await newPasskey();
        }
        working("Signing you in", "Deriving your keys on this device.");
        unlocked = await unlockWith(prf);
        const session = await guestLogin(unlocked);
        saveGuestSession(session);
        window.localStorage.setItem(HAS_PASSKEY_KEY, session.credentialId);
        notePasskey({ userId: unlocked.userId });
        unlocked.wipe();
        go("account", { intent, account: name });
    } catch (e) {
        unlocked?.wipe();
        if (e instanceof Unsupported) {
            $("unsupported-detail").textContent = e.message;
            show("unsupported");
            return;
        }
        renderWelcome();
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
    unlock: async (why, detail, adding, creating) => {
        if (creating) {
            // Creating the account the visitor just asked for: what their
            // passkey unlocked a page ago is still here (held-root.ts).
            const kept = await takeHeldRoot(session.credentialId, await fetchChainId());
            if (kept) {
                if (kept.guest.publicKey === session.publicKey) return kept;
                kept.wipe();
            }
        }
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
        // Everything this browser remembered is about another chain, the
        // passkey hint included (`verifyRemembered` drops it with the
        // accounts). The passkey still works and derives new keys here;
        // its holder says so with "I already have a passkey for this site".
        clearDevice();
        clearGuestSession();
        window.localStorage.removeItem(WHO_KEY);
        window.localStorage.removeItem(APPS_KEY);
        window.localStorage.setItem(NETWORK_KEY, id);
    }
};

/**
 * Checks what this browser remembers against the chain before any of it is
 * shown, and forgets what the chain does not bear out.
 *
 * - A remembered account that no longer exists is dropped.
 * - A remembered passkey with no account and no name picked for one is
 *   what a sign-out leaves on a browser that last ran an older version of
 *   this page (and what a chain started again leaves): forgotten, so the
 *   next name typed is a new user.
 * - If the chain cannot be asked, nothing remembered is shown.
 */
const verifyRemembered = async () => {
    verifiedHolder = {};
    window.localStorage.removeItem(WHO_KEY);
    if (!window.localStorage.getItem(HAS_PASSKEY_KEY)) return;
    const remembersSomeone = () => {
        const device = loadDevice();
        return device.accounts.length > 0 || !!device.pendingName;
    };
    if (remembersSomeone()) {
        try {
            for (const account of loadDevice().accounts) {
                if (!(await lookUpName(account.name)).exists) dropFromDevice(account.name);
            }
        } catch {
            return; // Not confirmed, so not shown.
        }
    }
    if (!remembersSomeone()) {
        clearDevice();
        forgetPasskeyHint();
        return;
    }
    verifiedHolder = currentHolder();
};

const start = async () => {
    $("network").textContent = rootName;
    // The network's name is the way home from any step of this page.
    $<HTMLAnchorElement>("network").href = `${window.location.protocol}//${root}/`;
    await forgetOtherNetwork();
    await sweepHeld();
    // The manage step has more to show than a sign-in card holds.
    if (step === "manage") document.body.dataset.layout = "wide";

    if (!window.PublicKeyCredential || !navigator.credentials) {
        $("unsupported-detail").textContent =
            "Signing in here uses a passkey, and this browser doesn't offer them.";
        show("unsupported");
        return;
    }

    $("start-form").addEventListener("submit", (e) => {
        e.preventDefault();
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
        $<HTMLInputElement>("start-name").value = "";
        $<HTMLInputElement>("start-pass").value = "";
        verifiedHolder = {};
        wanted = undefined;
        chosenLabel = undefined;
        nextMode = "auto";
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

    // "intent=guest": an app's Log out. The account leaves this app; the
    // visitor is then asked which account to use here, as on a first visit.
    if (query.get("intent") === "guest") {
        working("Signing out", `of ${destination.app}.${rootName}`);
        await logoutFor(destination.app).catch((e) => console.warn(e));
        rememberChoice(destination.app, undefined);
        const kept = new URLSearchParams(window.location.search);
        kept.delete("intent");
        window.location.replace(`${window.location.pathname}?${kept}`);
        return;
    }

    if (session) {
        const device = loadDevice();
        const who = device.current ?? "No account yet";
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

    await verifyRemembered();
    renderWelcome();
    if (networkChanged) {
        setNotice(
            "This network was started afresh since you were last here. Your passkey still works; accounts you had before need to be created again.",
        );
    }
};

void start();
