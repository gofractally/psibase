// The guest session this browser holds for the network, kept in the
// supervisor origin's storage. Only supervisor code reads it. It holds the
// node's session token and public identifiers; never a private key or
// passkey secret.

const STORAGE_KEY = "psibase.guest-session.v1";

export interface GuestSession {
    /** Session token issued by the node's guest login. */
    token: string;
    /** Guest id: hex of the first 16 bytes of sha256(public key). */
    guest: string;
    /** Token expiry, seconds since the epoch. */
    exp: number;
    /** Hex DER SubjectPublicKeyInfo of the guest's application key. */
    publicKey: string;
    /** Base64url WebAuthn credential id that derived the key. */
    credentialId: string;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

export const loadGuestSession = (): GuestSession | undefined => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw) as GuestSession;
        if (
            typeof parsed.token !== "string" ||
            typeof parsed.exp !== "number" ||
            parsed.exp <= nowSeconds() + 60
        ) {
            return undefined;
        }
        return parsed;
    } catch {
        return undefined;
    }
};

export const saveGuestSession = (session: GuestSession) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
};

export const clearGuestSession = () => {
    window.localStorage.removeItem(STORAGE_KEY);
};

/** Host (with port) of the network root, e.g. "psibase.localhost:8080". */
export const rootHost = (): string =>
    window.location.host.split(".").slice(1).join(".");

/** True when `url` is the network root or one of its subdomains. */
export const isNetworkUrl = (url: string): boolean => {
    try {
        const host = new URL(url, window.location.href).host;
        const root = rootHost();
        return host === root || host.endsWith("." + root);
    } catch {
        return false;
    }
};

/**
 * The bearer token to attach to a supervisor request that has no account
 * token of its own, so a guest's plugin and query traffic is attributed to
 * the guest. Never sent outside the network.
 */
export const guestBearerFor = (url: string): string | undefined => {
    if (!isNetworkUrl(url)) return undefined;
    return loadGuestSession()?.token;
};

/**
 * Fetch options for one of the supervisor's own queries, which are made
 * before, or without, an account: they go out as the guest.
 */
export const guestFetchOptions = (url: string): RequestInit | undefined => {
    const token = guestBearerFor(url);
    return token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
};

let signInRequested = false;

/**
 * Called when the node refuses a supervisor request for lack of a session.
 * Embedded in an app, the supervisor cannot navigate; it asks the app's
 * page to send the visitor through sign-in.
 */
export const requestSignIn = () => {
    if (signInRequested || window.parent === window) return;
    signInRequested = true;
    window.parent.postMessage({ type: "PSIBASE_SIGN_IN_REQUIRED" }, "*");
};

/** True for the node's "no session" answer to a supervisor request. */
export const isSignInRequired = (error: unknown): boolean =>
    String((error as Error)?.message ?? error).includes("sign-in required");
