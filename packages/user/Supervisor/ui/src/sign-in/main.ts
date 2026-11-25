// The network's front door. An app host sends a visitor here when the node
// does not know who they are; the visitor signs in with a passkey, becomes a
// guest, and is returned to the page they asked for.
//
// This page runs on the supervisor origin, the only origin allowed to use the
// passkey. The passkey secret and the key derived from it stay in this
// module: they are never stored, never posted, and never handed to an app.
import {
    type GuestSession,
    clearGuestSession,
    loadGuestSession,
    rootHost,
    saveGuestSession,
} from "../guest-session";
import { guestKeyFrom, prfInput } from "./guest-key";

// ---------------------------------------------------------------- helpers

const $ = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;

const toB64Url = (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

const fromB64Url = (text: string): Uint8Array => {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

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

const readDestination = (): Destination => {
    const params = new URLSearchParams(window.location.search);
    const app = params.get("app");
    const path = params.get("path") ?? "/";
    const pathOk =
        path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");
    if (app && ACCOUNT_NAME.test(app) && app !== "supervisor") {
        return { app, path: pathOk ? path : "/", explicit: true };
    }
    return { app: "homepage", path: "/", explicit: false };
};

const destination = readDestination();
const destinationUrl = siblingOrigin(destination.app) + destination.path;

// ------------------------------------------------------------------ views

const views = ["welcome", "working", "done", "unsupported"] as const;
type View = (typeof views)[number];

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

const shortId = (guest: string) => `${guest.slice(0, 4)}…${guest.slice(-4)}`;

const renderWelcome = () => {
    $("network").textContent = rootName;
    document.title = `Welcome · ${rootName}`;

    const knownPasskey = !!window.localStorage.getItem(HAS_PASSKEY_KEY);
    $("headline").textContent = knownPasskey ? "Welcome back" : "Welcome";
    $("lede").textContent = knownPasskey
        ? "Use your passkey to pick up where you left off."
        : "Create a passkey to step inside. It takes a few seconds, and you can explore before you decide on anything else.";
    $("btn-create-label").textContent = knownPasskey
        ? "Continue with your passkey"
        : "Continue with a passkey";
    $("btn-existing").textContent = knownPasskey
        ? "Create a new passkey instead"
        : "I already have a passkey here";

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

// ---------------------------------------------------------------- passkey

const HAS_PASSKEY_KEY = "psibase.has-passkey.v1";

class Unsupported extends Error {}
class Cancelled extends Error {}

interface PrfResult {
    credentialId: Uint8Array;
    secret: Uint8Array;
}

type PrfExtensionResults = {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
};

const prfExtension = () => ({ prf: { eval: { first: prfInput() } } });

const asCancelled = (e: unknown): never => {
    if (e instanceof DOMException && e.name === "NotAllowedError") {
        throw new Cancelled();
    }
    throw e;
};

/** Uses a passkey this visitor already has. */
const usePasskey = async (credentialId?: Uint8Array): Promise<PrfResult> => {
    const credential = (await navigator.credentials
        .get({
            publicKey: {
                challenge: randomBytes(32),
                userVerification: "required",
                allowCredentials: credentialId
                    ? [{ type: "public-key", id: credentialId }]
                    : [],
                extensions: prfExtension(),
            } as PublicKeyCredentialRequestOptions,
        })
        .catch(asCancelled)) as PublicKeyCredential | null;
    if (!credential) throw new Cancelled();
    const ext = credential.getClientExtensionResults() as PrfExtensionResults;
    const first = ext.prf?.results?.first;
    if (!first) {
        throw new Unsupported(
            "That passkey can't produce the secret this network derives your key from.",
        );
    }
    return {
        credentialId: new Uint8Array(credential.rawId),
        secret: new Uint8Array(first),
    };
};

/** Creates a new passkey, then reads its secret. */
const createPasskey = async (): Promise<PrfResult> => {
    const label = `Guest · ${new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    })}`;
    const credential = (await navigator.credentials
        .create({
            publicKey: {
                rp: { name: rootName },
                user: {
                    id: randomBytes(16),
                    name: `${rootName} (${label})`,
                    displayName: label,
                },
                challenge: randomBytes(32),
                pubKeyCredParams: [
                    { type: "public-key", alg: -7 },
                    { type: "public-key", alg: -257 },
                ],
                authenticatorSelection: {
                    residentKey: "required",
                    userVerification: "required",
                },
                extensions: prfExtension(),
            } as PublicKeyCredentialCreationOptions,
        })
        .catch(asCancelled)) as PublicKeyCredential | null;
    if (!credential) throw new Cancelled();

    const ext = credential.getClientExtensionResults() as PrfExtensionResults;
    const credentialId = new Uint8Array(credential.rawId);
    const first = ext.prf?.results?.first;
    if (first) return { credentialId, secret: new Uint8Array(first) };
    if (ext.prf?.enabled === false || !ext.prf) {
        throw new Unsupported(
            "This device made a passkey, but it can't produce the secret this network derives your key from.",
        );
    }
    // Some devices only release the secret when the passkey is used, not when
    // it is created. That takes one more confirmation.
    working("One more touch", "Confirm once more to finish setting up.");
    return usePasskey(credentialId);
};

// ------------------------------------------------------------------ node

const fetchChainId = async (): Promise<string> => {
    const res = await fetch("/common/chainid");
    if (!res.ok) throw new Error("Could not reach the network.");
    return (await res.json()) as string;
};

interface GuestLoginReply {
    access_token: string;
    guest: string;
    exp: number;
}

const guestLogin = async (prf: PrfResult): Promise<GuestSession> => {
    const chainId = await fetchChainId();
    const key = guestKeyFrom(prf.secret, chainId);
    prf.secret.fill(0);

    const exp = Math.floor(Date.now() / 1000) + 60;
    const proof = key.sign(`psibase guest login\n${rootName}\n${exp}`);
    const res = await fetch(`${siblingOrigin("transact")}/guest-login`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({ key: key.publicKey, exp, sig: proof }),
    });
    if (!res.ok) {
        throw new Error("The network did not accept the sign-in. Try again.");
    }
    const reply = (await res.json()) as GuestLoginReply;
    return {
        token: reply.access_token,
        guest: reply.guest,
        exp: reply.exp,
        publicKey: key.publicKey,
        credentialId: toB64Url(prf.credentialId),
    };
};

/** Gives the destination app its session cookie. */
const installCookie = async (session: GuestSession) => {
    const maxAge = Math.max(0, session.exp - Math.floor(Date.now() / 1000));
    const res = await fetch(
        `${siblingOrigin(destination.app)}/common/set-host-cookie`,
        {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "SESSION",
                value: session.token,
                maxAge,
                httpOnly: true,
            }),
        },
    );
    if (!res.ok) throw new Error("Could not start a session for this app.");
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

const goToDestination = async (session: GuestSession, celebrate: boolean) => {
    await installCookie(session);
    window.sessionStorage.setItem(BOUNCE_KEY, String(Date.now()));
    if (celebrate) {
        $("done-detail").textContent = destination.explicit
            ? `Taking you to ${destination.app}.${rootName}`
            : "Taking you inside";
        show("done");
        await new Promise((r) => setTimeout(r, 900));
    }
    window.location.replace(destinationUrl);
};

// ------------------------------------------------------------------ flow

const describeFailure = (e: unknown): string | undefined => {
    if (e instanceof Cancelled) return undefined; // The visitor changed their mind.
    if (e instanceof Error && e.message) return e.message;
    return "Something went wrong. Try again.";
};

const signIn = async (mode: "create" | "existing") => {
    setNotice();
    try {
        working(
            mode === "create" ? "Creating your passkey" : "Checking your passkey",
            "Follow the prompt from your device.",
        );
        const remembered = loadRememberedCredential();
        const prf =
            mode === "create"
                ? await createPasskey()
                : await usePasskey(remembered);
        working("Signing you in", "Deriving your key on this device.");
        const session = await guestLogin(prf);
        saveGuestSession(session);
        window.localStorage.setItem(HAS_PASSKEY_KEY, session.credentialId);
        await goToDestination(session, true);
    } catch (e) {
        if (e instanceof Unsupported) {
            $("unsupported-detail").textContent = e.message;
            show("unsupported");
            return;
        }
        renderWelcome();
        setNotice(describeFailure(e));
    }
};

const loadRememberedCredential = (): Uint8Array | undefined => {
    const id = window.localStorage.getItem(HAS_PASSKEY_KEY);
    try {
        return id ? fromB64Url(id) : undefined;
    } catch {
        return undefined;
    }
};

const start = async () => {
    $("network").textContent = rootName;

    if (!window.PublicKeyCredential || !navigator.credentials) {
        $("unsupported-detail").textContent =
            "Signing in here uses a passkey, and this browser doesn't offer them.";
        show("unsupported");
        return;
    }

    const knownPasskey = () => !!window.localStorage.getItem(HAS_PASSKEY_KEY);
    $("btn-create").addEventListener("click", () =>
        signIn(knownPasskey() ? "existing" : "create"),
    );
    $("btn-existing").addEventListener("click", () =>
        signIn(knownPasskey() ? "create" : "existing"),
    );

    const session = loadGuestSession();
    const forget = $("btn-forget");
    forget.addEventListener("click", () => {
        clearGuestSession();
        forget.hidden = true;
        $("foot-id").textContent = "";
        renderWelcome();
    });

    if (session) {
        $("foot-id").textContent = `Guest ${shortId(session.guest)}`;
        forget.hidden = false;
        if (returnedRecently()) {
            // We already sent them back once and the app did not accept it.
            clearGuestSession();
            renderWelcome();
            setNotice(
                "Your earlier sign-in is no longer valid here. Use your passkey to continue.",
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
