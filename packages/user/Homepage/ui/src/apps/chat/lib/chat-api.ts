import { siblingUrl } from "@psibase/common-lib";
import { z } from "zod";

import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";

import type { GraphqlSpaceEntry } from "./space-bridge";
import type { CallTimelineEventType } from "./protocol";
import { getHomepageQueryToken } from "./ws-auth";

const CHAT_SERVICE = zAccount.parse("chat");

const zSpaceKind = z.enum(["DM", "GROUP"]);

const zMySpacesResponse = z.object({
    mySpaces: z.array(
        z.object({
            spaceUuid: z.string(),
            members: z.array(z.string()),
            kind: zSpaceKind,
        }),
    ),
});

const zActiveSessionResponse = z.object({
    activeSession: z
        .object({
            sessionId: z.string(),
            spaceUuid: z.string(),
            purpose: z.string(),
            participants: z.array(z.string()),
            lifecycle: z.number(),
            expiresAt: z.number(),
            createdAt: z.number(),
        })
        .nullable(),
});

const zCallEventsResponse = z.object({
    callEvents: z.array(
        z.object({
            spaceUuid: z.string(),
            sessionId: z.string(),
            event: z.enum([
                "started",
                "ended",
                "missed",
                "declined",
                "cancelled",
                "failed",
            ]),
            account: z.string(),
            reason: z.string(),
            at: z.number(),
        }),
    ),
});

export type ChatObjectiveCallEvent = {
    sessionId: string;
    spaceUuid: string;
    event: CallTimelineEventType;
    actor: string;
    reason?: string;
    at: number;
};

export type ChatSessionEntry = {
    session_id: string;
    space_uuid: string;
    purpose: string;
    participants: string[];
    lifecycle: number;
    expires_at: number;
    created_at: number;
};

export const CHAT_DATA_PURPOSE = "chat-data";

export const AV_CALL_PURPOSE = "av-call";

/** Objective Chat session event kinds (matches Chat service SESSION_EVENT_*). */
export const CHAT_WEBRTC_EVENT_PARTICIPANT_JOINED = 1;
export const CHAT_WEBRTC_EVENT_PARTICIPANT_LEFT = 2;
export const CHAT_WEBRTC_EVENT_SESSION_FAILED = 3;
export const CHAT_WEBRTC_EVENT_SESSION_ENDED = 4;

/** Canonical member order matches objective Chat (sort by account string). */
export function canonicalChatParticipants(members: readonly string[]): string[] {
    return [...new Set(members)].sort((a, b) => a.localeCompare(b));
}

function extractGraphQLErrorMessage(body: unknown): string | null {
    if (typeof body !== "object" || body === null) return null;
    const obj = body as Record<string, unknown>;
    const errors = obj.errors;
    if (Array.isArray(errors) && errors.length > 0) {
        const first = errors[0];
        if (typeof first === "object" && first !== null) {
            const err = first as { message?: string };
            if (typeof err.message === "string") return err.message;
        }
    }
    if (typeof obj.message === "string") return obj.message;
    return null;
}

/** GraphQL to chat query-service with the Homepage session bearer token. */
async function authenticatedChatGraphql<T>(
    query: string,
    variables?: Record<string, unknown>,
): Promise<T> {
    const token = await getHomepageQueryToken();
    const host = siblingUrl(null, CHAT_SERVICE, null);
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`${host}/graphql`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
    });

    let body: unknown;
    try {
        const text = await res.text();
        body = text ? JSON.parse(text) : null;
    } catch {
        throw new Error(
            res.ok ? "Invalid JSON response" : `Request failed with status ${res.status}`,
        );
    }

    const graphqlMessage = extractGraphQLErrorMessage(body);
    if (graphqlMessage) {
        throw new Error(graphqlMessage);
    }

    if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
    }

    return (body as { data: T }).data;
}

export async function fetchMySpaces(): Promise<GraphqlSpaceEntry[]> {
    const data = await authenticatedChatGraphql<unknown>(`
        query MySpaces {
            mySpaces {
                spaceUuid
                members
                kind
            }
        }
    `);
    const parsed = zMySpacesResponse.parse(data);
    return parsed.mySpaces.map((row) => ({
        space_uuid: row.spaceUuid,
        members: row.members,
        kind: row.kind,
    }));
}

/**
 * Plan D (out-of-scope follow-up roadmap): direct chain calls to `ensureDm` /
 * `ensureGroup` are kept as designed. `space_uuid = "space:" + sha256(canonical
 * member list)` is deterministic; both methods are idempotent on-chain; the
 * compose-first UX in `dm-first-message-send.ts` already lets the user type
 * before the chain round-trip returns. There are 4 direct callsites today
 * (use-chat-socket.ts:2853, 2901, 3067, 3138) and the small follow-ups
 * (concurrent-tx dedup, optimistic sidebar from client-derived space_uuid,
 * consolidating the open / first-send / Meet UI paths) are <1 day of polish
 * each — see plan §D for the full justification. Filed as backlog rather than
 * a plan.
 */
export async function ensureDm(contact: string): Promise<void> {
    await supervisor.functionCall({
        service: CHAT_SERVICE,
        plugin: "plugin",
        intf: "api",
        method: "ensure-dm",
        params: [contact],
    });
}

export async function ensureGroup(otherMembers: string[]): Promise<void> {
    await supervisor.functionCall({
        service: CHAT_SERVICE,
        plugin: "plugin",
        intf: "api",
        method: "ensure-group",
        params: [otherMembers],
    });
}

export async function createChatDataSession(
    spaceUuid: string,
    participants: readonly string[],
): Promise<void> {
    await supervisor.functionCall({
        service: CHAT_SERVICE,
        plugin: "plugin",
        intf: "api",
        method: "create-session",
        params: [spaceUuid, CHAT_DATA_PURPOSE, canonicalChatParticipants(participants)],
    });
}

export async function fetchActiveChatDataSession(
    spaceUuid: string,
): Promise<ChatSessionEntry | null> {
    const data = await authenticatedChatGraphql<unknown>(
        `
        query ActiveChatDataSession($spaceUuid: String!, $purpose: String!) {
            activeSession(spaceUuid: $spaceUuid, purpose: $purpose) {
                sessionId
                spaceUuid
                purpose
                participants
                lifecycle
                expiresAt
                createdAt
            }
        }
    `,
        { spaceUuid, purpose: CHAT_DATA_PURPOSE },
    );
    const parsed = zActiveSessionResponse.parse(data);
    const row = parsed.activeSession;
    if (!row) return null;
    return {
        session_id: row.sessionId,
        space_uuid: row.spaceUuid,
        purpose: row.purpose,
        participants: row.participants,
        lifecycle: row.lifecycle,
        expires_at: row.expiresAt,
        created_at: row.createdAt,
    };
}

const ACTIVE_SESSION_LIFECYCLE = 1;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        globalThis.setTimeout(resolve, ms);
    });
}

export async function createAvCallSession(
    spaceUuid: string,
    participants: readonly string[],
): Promise<void> {
    await supervisor.functionCall({
        service: CHAT_SERVICE,
        plugin: "plugin",
        intf: "api",
        method: "create-session",
        params: [spaceUuid, AV_CALL_PURPOSE, canonicalChatParticipants(participants)],
    });
}

export async function closeAvCallSession(
    sessionId: string,
    reason: string,
): Promise<void> {
    await supervisor.functionCall({
        service: CHAT_SERVICE,
        plugin: "plugin",
        intf: "api",
        method: "close-session",
        params: [sessionId, reason],
    });
}

/** Record join/leave lifecycle on objective Chat after x-wrtcsig signaling. */
export async function commitWebRtcSessionEvent(
    sessionId: string,
    kind: number,
    reason: string,
): Promise<void> {
    await supervisor.functionCall({
        service: CHAT_SERVICE,
        plugin: "plugin",
        intf: "api",
        method: "commit-webrtc-session-event",
        params: [sessionId, kind, reason],
    });
}

export async function fetchActiveAvCallSession(
    spaceUuid: string,
): Promise<ChatSessionEntry | null> {
    const data = await authenticatedChatGraphql<unknown>(
        `
        query ActiveAvCallSession($spaceUuid: String!, $purpose: String!) {
            activeSession(spaceUuid: $spaceUuid, purpose: $purpose) {
                sessionId
                spaceUuid
                purpose
                participants
                lifecycle
                expiresAt
                createdAt
            }
        }
    `,
        { spaceUuid, purpose: AV_CALL_PURPOSE },
    );
    const parsed = zActiveSessionResponse.parse(data);
    const row = parsed.activeSession;
    if (!row) return null;
    return {
        session_id: row.sessionId,
        space_uuid: row.spaceUuid,
        purpose: row.purpose,
        participants: row.participants,
        lifecycle: row.lifecycle,
        expires_at: row.expiresAt,
        created_at: row.createdAt,
    };
}

/** Objective av-call timeline events for a Space (architecture §6.4). */
export async function fetchSpaceCallEvents(
    spaceUuid: string,
): Promise<ChatObjectiveCallEvent[]> {
    const data = await authenticatedChatGraphql<unknown>(
        `
        query SpaceCallEvents($spaceUuid: String!) {
            callEvents(spaceUuid: $spaceUuid) {
                spaceUuid
                sessionId
                event
                account
                reason
                at
            }
        }
    `,
        { spaceUuid },
    );
    const parsed = zCallEventsResponse.parse(data);
    return parsed.callEvents.map((row) => ({
        sessionId: row.sessionId,
        spaceUuid: row.spaceUuid,
        event: row.event,
        actor: row.account,
        reason: row.reason || undefined,
        at: row.at,
    }));
}

/** Poll until objective chat-data session exists (post-transaction). */
export async function waitForActiveChatDataSession(
    spaceUuid: string,
    maxAttempts = 24,
): Promise<ChatSessionEntry | null> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const row = await fetchActiveChatDataSession(spaceUuid);
        if (row && row.lifecycle === ACTIVE_SESSION_LIFECYCLE) {
            return row;
        }
        await sleep(Math.min(250 * (attempt + 1), 2_000));
    }
    return null;
}

/** Poll until objective av-call session exists (post-transaction). */
export async function waitForActiveAvCallSession(
    spaceUuid: string,
    maxAttempts = 24,
): Promise<ChatSessionEntry | null> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const row = await fetchActiveAvCallSession(spaceUuid);
        if (row && row.lifecycle === ACTIVE_SESSION_LIFECYCLE) {
            return row;
        }
        await sleep(Math.min(250 * (attempt + 1), 2_000));
    }
    return null;
}
