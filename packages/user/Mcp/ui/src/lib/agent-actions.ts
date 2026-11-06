/** Pure helpers for the agent signing page (unit-tested with vitest). */

export type RawAction = { service: string; method: string; rawData: string };

/**
 * Accept what an agent is likely to paste: a bare action array, or the
 * X-MCP `build_transaction` result (optionally `propose`-wrapped), and
 * return the inner actions with hex rawData.
 */
export function normalizeActions(input: string): RawAction[] {
    const v = JSON.parse(input);
    let list: unknown[];
    if (Array.isArray(v)) list = v;
    else if (v && typeof v === "object") {
        const tx = (v as { transaction?: { actions?: unknown[] } }).transaction;
        if (!tx || !Array.isArray(tx.actions)) {
            throw new Error(
                "expected an actions array or a build_transaction result",
            );
        }
        list = tx.actions;
    } else {
        throw new Error(
            "expected an actions array or a build_transaction result",
        );
    }
    if (
        list.length === 1 &&
        isAction(list[0]) &&
        list[0].service === "staged-tx" &&
        list[0].method === "propose"
    ) {
        const inner = (list[0] as { data?: { actions?: unknown[] } }).data
            ?.actions;
        if (!Array.isArray(inner)) {
            throw new Error("propose wrapper has no decoded data.actions");
        }
        list = inner;
    }
    return list.map((a, i) => {
        if (!isAction(a) || typeof a.rawData !== "string") {
            throw new Error(`action ${i}: need service, method, rawData (hex)`);
        }
        return { service: a.service, method: a.method, rawData: a.rawData };
    });
}

function isAction(
    a: unknown,
): a is { service: string; method: string; rawData?: unknown } {
    return (
        !!a &&
        typeof a === "object" &&
        typeof (a as { service?: unknown }).service === "string" &&
        typeof (a as { method?: unknown }).method === "string"
    );
}

/** Prefill from `?agent=&owner=&actions=` (legacy `managed=` accepted) (key is never read from the URL). */
export function prefillFromSearch(search: string) {
    const p = new URLSearchParams(search);
    return {
        agent: p.get("agent") ?? "",
        owner: p.get("owner") ?? p.get("managed") ?? "",
        actions: p.get("actions") ?? "",
    };
}

export type AgentResult =
    | { ok: true; executed: true }
    | { ok: true; executed: false; stagedId: number; tracked: boolean }
    | { ok: false; error: string };
