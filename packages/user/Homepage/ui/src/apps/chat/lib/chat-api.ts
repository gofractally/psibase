import { siblingUrl } from "@psibase/common-lib";
import { z } from "zod";

import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";

import type { GraphqlSpaceEntry } from "./space-bridge";
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
async function authenticatedChatGraphql<T>(query: string): Promise<T> {
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
        body: JSON.stringify({ query }),
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
