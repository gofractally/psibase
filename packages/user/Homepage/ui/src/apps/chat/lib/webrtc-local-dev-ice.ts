/** Psibase local nodes use `.localhost` hostnames; WebRTC mDNS candidates fail cross-tab. */

export function isLocalDevWebRtcHost(hostname: string): boolean {
    const h = hostname.trim().toLowerCase();
    return h === "localhost" || h.endsWith(".localhost");
}

export function isLocalDevWebRtcEnvironment(): boolean {
    if (typeof globalThis.location === "undefined") return false;
    return isLocalDevWebRtcHost(globalThis.location.hostname);
}

/**
 * Chrome masks host ICE addresses behind `<uuid>.local` mDNS names. Two browser
 * profiles on the same machine cannot resolve each other's names; loopback works.
 */
export function rewriteMdnsIceCandidate(candidate: string): string {
    const line = candidate.trim();
    if (!line.includes(".local")) return line;

    const parts = line.split(/\s+/);
    if (parts.length < 6) return line;

    const addressIdx = 4;
    const address = parts[addressIdx];
    if (!address?.endsWith(".local")) return line;

    parts[addressIdx] = "127.0.0.1";
    return parts.join(" ");
}

export function normalizeIceCandidateForEnvironment(
    candidate: string | null | undefined,
): string | null {
    if (candidate == null || candidate === "") return null;
    if (!isLocalDevWebRtcEnvironment()) return candidate;
    return rewriteMdnsIceCandidate(candidate);
}
