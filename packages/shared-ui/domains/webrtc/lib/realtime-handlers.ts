import type { ServerRealtimeFrame } from "./realtime-protocol";

export type RealtimeHandlers = {
    [K in ServerRealtimeFrame["t"]]?: (
        frame: Extract<ServerRealtimeFrame, { t: K }>,
    ) => void;
};

function chainHandlers(
    prev: RealtimeHandlers,
    extra: RealtimeHandlers,
): RealtimeHandlers {
    type HandlerFn = (frame: ServerRealtimeFrame) => void;
    const merged: Record<string, HandlerFn | undefined> = {
        ...(prev as Record<string, HandlerFn | undefined>),
    };
    for (const key of Object.keys(extra) as (keyof RealtimeHandlers)[]) {
        const next = extra[key] as HandlerFn | undefined;
        if (!next) continue;
        const existing = merged[key as string];
        if (existing) {
            merged[key as string] = (frame) => {
                existing(frame);
                next(frame);
            };
        } else {
            merged[key as string] = next;
        }
    }
    return merged as RealtimeHandlers;
}

export function mergeRealtimeHandlers(
    ...groups: readonly RealtimeHandlers[]
): RealtimeHandlers {
    let merged: RealtimeHandlers = {};
    for (const group of groups) {
        merged = chainHandlers(merged, group);
    }
    return merged;
}

export { chainHandlers };
