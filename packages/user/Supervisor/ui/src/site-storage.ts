/** Safari partitions iframe localStorage by top-level site. Same-site
 *  cookies with Domain=root are visible to prompt.html and the homepage
 *  iframe. Never persist key material or query JWTs. */

const COOKIE_PREFIX = "psibase_ls_";
const CHUNK = 2000;
const MAX_CHUNKS = 20;

function cookieDomain(): string | undefined {
    const host = window.location.hostname;
    if (host === "localhost" || host.endsWith(".localhost")) {
        return undefined;
    }
    const parts = host.split(".");
    if (parts.length < 2) {
        return undefined;
    }
    return parts.slice(1).join(".");
}

function cookieAttrs(maxAge: number): string {
    const domain = cookieDomain();
    const domainPart = domain ? `; Domain=${domain}` : "";
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    return `Path=/; SameSite=Lax${domainPart}${secure}; Max-Age=${maxAge}`;
}

function readCookie(name: string): string | undefined {
    const prefix = `${name}=`;
    for (const part of document.cookie.split(";")) {
        const trimmed = part.trim();
        if (trimmed.startsWith(prefix)) {
            return trimmed.slice(prefix.length);
        }
    }
    return undefined;
}

function writeCookie(name: string, value: string, maxAge: number): void {
    document.cookie = `${name}=${value}; ${cookieAttrs(maxAge)}`;
}

function clearCookie(name: string): void {
    writeCookie(name, "", 0);
}

export function shouldPersistKey(key: string): boolean {
    return (
        !key.includes(":keys:") &&
        !key.includes(":temp_keys:") &&
        !key.includes(":query_tokens-")
    );
}

function readChunked(): string | undefined {
    const chunks: string[] = [];
    for (let i = 0; i < MAX_CHUNKS; i++) {
        const piece = readCookie(`${COOKIE_PREFIX}${i}`);
        if (piece === undefined) {
            break;
        }
        chunks.push(piece);
    }
    if (chunks.length === 0) {
        return undefined;
    }
    return chunks.join("");
}

function writeChunked(payload: string): void {
    if (!payload) {
        for (let i = 0; i < MAX_CHUNKS; i++) {
            clearCookie(`${COOKIE_PREFIX}${i}`);
        }
        return;
    }
    const n = Math.ceil(payload.length / CHUNK);
    if (n > MAX_CHUNKS) {
        console.warn(
            "Supervisor site storage exceeds cookie budget; keeping previous backup",
        );
        return;
    }
    for (let i = 0; i < n; i++) {
        writeCookie(
            `${COOKIE_PREFIX}${i}`,
            payload.slice(i * CHUNK, (i + 1) * CHUNK),
            31536000,
        );
    }
    for (let i = n; i < MAX_CHUNKS; i++) {
        clearCookie(`${COOKIE_PREFIX}${i}`);
    }
}

export function persistLocalStorageToSiteCookies(): void {
    try {
        const dump: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !shouldPersistKey(key)) continue;
            const value = localStorage.getItem(key);
            if (value !== null) {
                dump[key] = value;
            }
        }
        const json = JSON.stringify(dump);
        const payload = btoa(unescape(encodeURIComponent(json)));
        writeChunked(payload);
    } catch (e) {
        console.warn("Supervisor site storage persist failed", e);
    }
}

export function restoreLocalStorageFromSiteCookies(): void {
    try {
        const payload = readChunked();
        if (!payload) {
            return;
        }
        const json = decodeURIComponent(escape(atob(payload)));
        const dump = JSON.parse(json) as Record<string, string>;
        for (const [key, value] of Object.entries(dump)) {
            if (!shouldPersistKey(key)) continue;
            localStorage.setItem(key, value);
        }
    } catch (e) {
        console.warn("Supervisor site storage restore failed", e);
    }
}
