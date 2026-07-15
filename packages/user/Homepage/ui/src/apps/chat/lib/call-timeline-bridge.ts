import type { CallTimelineEventType } from "./protocol";

export type ChatObjectiveCallEvent = {
    sessionId: string;
    spaceUuid: string;
    event: CallTimelineEventType;
    actor: string;
    reason?: string;
    at: number;
};

export type ObjectiveCallTimelineRow = {
    kind: "callEvent";
    key: string;
    conversationId: string;
    callId?: string;
    event: CallTimelineEventType;
    actor?: string;
    reason?: string;
    durationMs?: number;
    serverMsgId: number;
    serverTime: number;
};

export function objectiveCallEventToTimelineRow(
    event: ChatObjectiveCallEvent,
): ObjectiveCallTimelineRow {
    return {
        kind: "callEvent",
        key: `obj-${event.sessionId}-${event.at}-${event.event}`,
        conversationId: event.spaceUuid,
        callId: event.sessionId,
        event: event.event,
        actor: event.actor,
        reason: event.reason,
        serverMsgId: event.at,
        serverTime: event.at,
    };
}

export function mergeObjectiveCallEventsIntoTimeline(
    existing: ObjectiveCallTimelineRow[],
    incoming: ChatObjectiveCallEvent[],
): ObjectiveCallTimelineRow[] {
    const byKey = new Map(existing.map((row) => [row.key, row]));
    for (const event of incoming) {
        const row = objectiveCallEventToTimelineRow(event);
        byKey.set(row.key, row);
    }
    return [...byKey.values()].sort((a, b) => a.serverTime - b.serverTime);
}
