/**
 * Client-side ICE helpers for `x-webrtc-sig` welcome payloads.
 *
 * STUN defaults and TURN merge happen server-side in the `welcome` frame; clients
 * validate entries and map them to `RTCPeerConnection` configuration.
 */
import type { IceServerConfig } from "./protocol";

const FALLBACK_STUN: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
];

function urlScheme(u: string): string {
    const t = u.trim();
    const i = t.indexOf(":");
    if (i <= 0) return "";
    return t.slice(0, i).toLowerCase();
}

function listUrls(s: IceServerConfig): string[] {
    return typeof s.urls === "string" ? [s.urls] : s.urls;
}

/** Match `x-webrtc-sig` service validation: STUN without secrets; TURN requires credentials. */
export function iceServerConfigIsValidForClients(s: IceServerConfig): boolean {
    const urls = listUrls(s)
        .map((u) => u.trim())
        .filter(Boolean);
    if (!urls.length) return false;
    const schemes = urls.map(urlScheme);
    const hasTurn = schemes.some((x) => x === "turn" || x === "turns");
    const hasStun = schemes.some((x) => x === "stun" || x === "stuns");
    if (hasTurn) {
        const u = s.username?.trim() ?? "";
        const c = s.credential?.trim() ?? "";
        return u.length > 0 && c.length > 0;
    }
    return hasStun && !s.username && !s.credential;
}

function sanitizeIceConfig(servers: IceServerConfig[]): IceServerConfig[] {
    return servers.filter((s) => iceServerConfigIsValidForClients(s));
}

export function toRtcIceServers(servers: IceServerConfig[] | null): RTCIceServer[] {
    if (!servers?.length) return FALLBACK_STUN;
    const cleaned = sanitizeIceConfig(servers);
    if (!cleaned.length) return FALLBACK_STUN;
    return cleaned.map((s) => {
        const base: RTCIceServer = {
            urls: s.urls as string | string[],
        };
        if (s.username != null && s.username !== "") {
            base.username = s.username;
        }
        if (s.credential != null && s.credential !== "") {
            base.credential = s.credential;
        }
        return base;
    });
}

function rtcIceHasTurn(rtcIce: RTCIceServer[]): boolean {
    return rtcIce.some((s) => {
        const urls =
            typeof s.urls === "string" ? [s.urls] : (s.urls ?? []);
        return urls.some(
            (u) => u.startsWith("turn:") || u.startsWith("turns:"),
        );
    });
}

/** STUN-only configs often break same-machine / hairpin NAT; host candidates still work on LAN. */
export function buildRtcPeerConnectionConfig(
    servers: IceServerConfig[] | null,
): RTCConfiguration {
    const rtcIce = toRtcIceServers(servers);
    if (!rtcIceHasTurn(rtcIce)) {
        return { iceServers: [] };
    }
    return { iceServers: rtcIce };
}

export function iceServerSummary(
    servers: IceServerConfig[] | null,
): Record<string, unknown> {
    const rtc = toRtcIceServers(servers);
    const hasTurn = rtcIceHasTurn(rtc);
    return {
        configuredCount: servers?.length ?? 0,
        rtcCount: rtc.length,
        urls: rtc.flatMap((s) =>
            typeof s.urls === "string" ? [s.urls] : s.urls,
        ),
        hasTurn,
        hostOnly: !hasTurn,
    };
}
