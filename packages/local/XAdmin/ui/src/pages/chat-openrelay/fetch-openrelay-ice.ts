import { z } from "zod";

import { iceServerConfigSchema } from "@shared/domains/webrtc";

const iceServersArraySchema = z.array(iceServerConfigSchema);

export type OpenRelayIceServer = z.infer<typeof iceServerConfigSchema>;

/** Strip vendor-specific keys (e.g. Metered `credentialType`) before strict parse. */
function normalizeIceServerEntry(entry: unknown): unknown {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return entry;
    }
    const e = entry as Record<string, unknown>;
    const out: Record<string, unknown> = { urls: e.urls };
    if (e.username != null) out.username = e.username;
    if (e.credential != null) out.credential = e.credential;
    return out;
}

/** Parse/validate a pasted or fetched ICE server list for OpenRelay storage. */
export function parseOpenRelayIceServers(data: unknown): OpenRelayIceServer[] {
    if (!Array.isArray(data)) {
        throw new Error("Paste a JSON array of ice server objects.");
    }
    const normalized = data.map(normalizeIceServerEntry);
    const parsed = iceServersArraySchema.safeParse(normalized);
    if (!parsed.success) {
        throw new Error(
            `Invalid iceServers JSON: ${parsed.error.issues
                .slice(0, 3)
                .map((i) => i.message)
                .join("; ")}`,
        );
    }
    return parsed.data;
}

export async function fetchOpenRelayIceServers(
    appName: string,
    apiKey: string,
): Promise<OpenRelayIceServer[]> {
    const sub = appName
        .trim()
        .replace(/^https?:\/\//i, "")
        .replace(/\.metered\.live\/?$/i, "");
    if (!sub || !apiKey.trim()) {
        throw new Error(
            "App name and API key are required to fetch from OpenRelay.",
        );
    }
    const url = `https://${sub}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey.trim())}`;
    const res = await fetch(url);
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
            `OpenRelay request failed (${res.status}). ${text.slice(0, 240)}`,
        );
    }
    const data: unknown = await res.json();
    if (Array.isArray(data)) {
        return parseOpenRelayIceServers(data);
    }
    if (
        data &&
        typeof data === "object" &&
        "iceServers" in data &&
        Array.isArray((data as { iceServers: unknown }).iceServers)
    ) {
        return parseOpenRelayIceServers(
            (data as { iceServers: unknown[] }).iceServers,
        );
    }
    throw new Error(
        "Unexpected JSON from OpenRelay. Paste the iceServers array manually below.",
    );
}
