export const PAIR_SESSION_PREFIX = "wrtc:pair:";

/** Lex-ordered account pair for stable initiator and session id. */
export function canonicalPairAccounts(
    a: string,
    b: string,
): [string, string] {
    return a.localeCompare(b) <= 0 ? [a, b] : [b, a];
}

/** Deterministic pair signaling session id. */
export function pairSessionId(local: string, remote: string): string {
    const [lower, higher] = canonicalPairAccounts(local, remote);
    return `${PAIR_SESSION_PREFIX}${lower}:${higher}`;
}

export function parsePairSessionId(
    sessionId: string,
): [string, string] | null {
    if (!sessionId.startsWith(PAIR_SESSION_PREFIX)) return null;
    const rest = sessionId.slice(PAIR_SESSION_PREFIX.length);
    const colon = rest.indexOf(":");
    if (colon <= 0 || colon >= rest.length - 1) return null;
    const lower = rest.slice(0, colon);
    const higher = rest.slice(colon + 1);
    if (!lower || !higher) return null;
    return [lower, higher];
}

/** True when `account` is the lex-lower side (impolite / offer initiator). */
export function isLexInitiator(local: string, remote: string): boolean {
    const [lower] = canonicalPairAccounts(local, remote);
    return local === lower;
}
