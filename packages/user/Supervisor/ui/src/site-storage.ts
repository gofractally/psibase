/** Safari partitions third-party iframe localStorage by top-level site.
 *  prompt.html is first-party supervisor; homepage embeds supervisor as a
 *  third-party iframe, so login/keys written during a prompt are invisible
 *  after redirect. Same-site cookies with Domain=root host are shared. */

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
    for (let i = 0; i < MAX_CHUNKS; i++) {
        clearCookie(`${COOKIE_PREFIX}${i}`);
    }
    if (!payload) {
        return;
    }
    const n = Math.ceil(payload.length / CHUNK);
    if (n > MAX_CHUNKS) {
        console.warn("Supervisor site storage exceeds cookie budget; skipping sync");
        return;
    }
    for (let i = 0; i < n; i++) {
        writeCookie(
            `${COOKIE_PREFIX}${i}`,
            payload.slice(i * CHUNK, (i + 1) * CHUNK),
            31536000,
        );
    }
}

export function persistLocalStorageToSiteCookies(): void {
    try {
        const dump: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
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
            localStorage.setItem(key, value);
        }
    } catch (e) {
        console.warn("Supervisor site storage restore failed", e);
    }
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;

export function schedulePersistLocalStorageToSiteCookies(): void {
    if (persistTimer !== undefined) {
        clearTimeout(persistTimer);
    }
    persistTimer = setTimeout(() => {
        persistTimer = undefined;
        persistLocalStorageToSiteCookies();
    }, 0);
}
