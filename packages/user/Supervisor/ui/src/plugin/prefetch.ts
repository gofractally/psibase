// Start-up prefetch of the plugins an app used last time.
//
// The loader finds an app's plugins by walking: fetch a plugin, parse it,
// read what it imports, fetch those, and so on. Every level waits for the one
// before, so over a real network a page waits a round trip per level (and one
// more per service for its dependency map) before its first call can run.
//
// The walk is left exactly as it is. This only remembers, per app, which
// plugins and services the walk ended up needing, and at the next start asks
// for all of them at once. When the walk then reaches a plugin its bytes are
// already here. A remembered list that is out of date costs a wasted request
// or misses a new plugin, which the walk then fetches as before; it cannot
// make the supervisor load anything the walk would not.
import { QualifiedPluginId, siblingUrl } from "@psibase/common-lib";

import { guestBearerFor } from "../guest-session";
import { networkName } from "../utils";

const KEY = "psibase.plugin-graph.v1";
const LIMIT = 120;

type Stored = Record<string, string[]>;

const read = (): Stored => {
    try {
        return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Stored;
    } catch {
        return {};
    }
};

/** Where a plugin's file is served. */
export const pluginUrl = ({ service, plugin }: QualifiedPluginId): string => {
    // The homepage service is served from the configured network name's
    // subdomain. Fetching it via the "homepage" alias would redirect,
    // which breaks authenticated (preflighted) requests.
    const host = service === "homepage" && networkName ? networkName : service;
    return siblingUrl(null, host, `/${plugin}.wasm`);
};

const isHost = (service: string) => service === "wasi" || service === "supervisor";

let app: string | undefined;
const seen = new Set<string>();
const failed = new Set<string>();
const bytes = new Map<string, Promise<Uint8Array | undefined>>();
const maps = new Map<string, Promise<unknown | undefined>>();
let timer: number | undefined;

const persist = () => {
    if (!app) return;
    const all = read();
    const merged = new Set([...(all[app] ?? []), ...seen]);
    for (const id of failed) merged.delete(id);
    all[app] = [...merged].slice(-LIMIT);
    try {
        window.localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
        // Only an optimisation.
    }
};

// A page that is left while the list is still growing keeps what it has.
window.addEventListener("pagehide", persist);

/** Notes a plugin the loader has asked for. */
export const notePlugin = (id: QualifiedPluginId) => {
    if (isHost(id.service)) return;
    const key = `${id.service}:${id.plugin}`;
    if (seen.has(key)) return;
    seen.add(key);
    window.clearTimeout(timer);
    timer = window.setTimeout(persist, 200);
};

const quietBytes = async (url: string): Promise<Uint8Array | undefined> => {
    try {
        const token = guestBearerFor(url);
        const res = await fetch(url, {
            headers: token ? [["Authorization", `Bearer ${token}`]] : [],
        });
        if (!res.ok) return undefined;
        return new Uint8Array(await res.arrayBuffer());
    } catch {
        return undefined;
    }
};

/**
 * Asks at once for everything `forApp` needed last time. `serviceMap` is the
 * loader's own look-up of a service's dependency map.
 */
export const warm = (
    forApp: string,
    serviceMap: (service: string) => Promise<unknown>,
) => {
    if (app !== undefined) return;
    app = forApp;
    const services = new Set<string>();
    for (const key of read()[forApp] ?? []) {
        const [service, plugin] = key.split(":");
        if (!service || !plugin || isHost(service)) continue;
        // Its address is only known once the network's name is.
        if (service === "homepage" && !networkName) continue;
        const url = pluginUrl({ service, plugin });
        if (!bytes.has(url)) {
            bytes.set(
                url,
                quietBytes(url).then((b) => {
                    if (!b) failed.add(key);
                    return b;
                }),
            );
        }
        services.add(service);
    }
    for (const service of services) {
        if (!maps.has(service)) {
            maps.set(
                service,
                serviceMap(service).catch(() => undefined),
            );
        }
    }
};

/** The prefetched file for `url`, once; nothing if it was not asked for or failed. */
export const takeBytes = async (url: string): Promise<Uint8Array | undefined> => {
    const pending = bytes.get(url);
    if (!pending) return undefined;
    bytes.delete(url);
    return pending;
};

/** The prefetched dependency map of `service`, once. */
export const takeMap = (service: string): Promise<unknown | undefined> | undefined => {
    const pending = maps.get(service);
    if (pending) maps.delete(service);
    return pending;
};
