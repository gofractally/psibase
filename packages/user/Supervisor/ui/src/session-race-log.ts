import { QualifiedFunctionCallArgs } from "@psibase/common-lib";
import { pluginString, QualifiedPluginId } from "@psibase/common-lib/messaging";

const LOG_PREFIX = "[supervisor-race]";

type SessionKind = "entry" | "preloadPlugins" | "getJson";

type ActiveSession = {
    kind: SessionKind;
    requestId: string;
    label: string;
    phase: string;
};

let nextHandle = 1;
const active = new Map<number, ActiveSession>();

function activeSummary(exclude?: number): string {
    const others = [...active.entries()]
        .filter(([handle]) => handle !== exclude)
        .map(([, s]) => `${s.kind}:${s.requestId.slice(0, 8)}@${s.phase}`);
    return others.length ? others.join(", ") : "(none)";
}

function logRace(message: string, handle: number): void {
    console.warn(
        `${LOG_PREFIX} *** RACE *** ${message} | still active: ${activeSummary(handle)}`,
    );
}

export function logMessageReceived(
    kind: SessionKind,
    requestId: string,
    detail: string,
): void {
    console.info(
        `${LOG_PREFIX} postMessage → ${kind} id=${requestId.slice(0, 8)} ${detail} | active now: ${active.size} [${activeSummary()}]`,
    );
}

export function beginSession(
    kind: SessionKind,
    requestId: string,
    label: string,
): number {
    const handle = nextHandle++;
    const concurrent = active.size > 0;
    active.set(handle, { kind, requestId, label, phase: "start" });

    console.info(
        `${LOG_PREFIX} ${kind} BEGIN #${handle} id=${requestId.slice(0, 8)} ${label} | concurrent=${concurrent} active=${active.size} [${activeSummary(handle)}]`,
    );

    if (concurrent) {
        logRace(
            `session #${handle} (${label}) started while others in flight`,
            handle,
        );
    }

    return handle;
}

export function sessionPhase(handle: number, phase: string): void {
    const session = active.get(handle);
    if (!session) {
        return;
    }
    session.phase = phase;
    console.info(
        `${LOG_PREFIX} ${session.kind} #${handle} id=${session.requestId.slice(0, 8)} → ${phase} | active=${active.size}`,
    );
}

export function logDisposeAll(handle: number, disposed: string[]): void {
    const session = active.get(handle);
    const others = active.size > 1 ? active.size - 1 : 0;
    console.info(
        `${LOG_PREFIX} disposeAll from #${handle} (${session?.label ?? "?"}) disposed=${disposed.length} | other sessions still active=${others}`,
    );
    if (others > 0) {
        logRace(
            `disposeAll from #${handle} while ${others} other session(s) still active — shared plugin instances may be cleared mid-flight`,
            handle,
        );
    }
}

export function logEntryCall(
    handle: number,
    args: QualifiedFunctionCallArgs,
    instantiated: boolean,
): void {
    const target = `${args.service}:${args.plugin}/${args.intf ?? ""}->${args.method}`;
    console.info(
        `${LOG_PREFIX} entry #${handle} CALL ${target} instantiated=${instantiated}`,
    );
    if (!instantiated) {
        logRace(`entry #${handle} calling ${target} but plugin not instantiated`, handle);
    }
}

export function endSession(
    handle: number,
    outcome: "ok" | "error",
    detail?: string,
): void {
    const session = active.get(handle);
    active.delete(handle);
    console.info(
        `${LOG_PREFIX} ${session?.kind ?? "session"} END #${handle} id=${session?.requestId.slice(0, 8) ?? "?"} ${outcome}${detail ? ` (${detail})` : ""} | remaining active=${active.size}`,
    );
}

export function formatEntryLabel(args: QualifiedFunctionCallArgs): string {
    return `${args.service}:${args.plugin}/${args.intf ?? ""}->${args.method}`;
}

export function formatPluginLabel(plugin: QualifiedPluginId): string {
    return pluginString(plugin);
}

export function logReproHint(): void {
    console.info(
        `${LOG_PREFIX} Repro: load Homepage — Layout useCurrentUser + sidebar NetworkLogo useBranding fire parallel entry() calls. Look for concurrent=true and *** RACE *** disposeAll lines.`,
    );
}
