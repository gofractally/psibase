import { graphql } from "@shared/lib/graphql";
import { zAccount } from "@shared/lib/schemas/account";
import { z } from "zod";

const MEET = zAccount.parse("meet");

const zBytes = z.array(z.number()).or(z.string()).transform((value) => {
    if (typeof value === "string") {
        if (value.startsWith("0x")) {
            const hex = value.slice(2);
            const out: number[] = [];
            for (let i = 0; i < hex.length; i += 2) {
                out.push(parseInt(hex.slice(i, i + 2), 16));
            }
            return out;
        }
        try {
            return Array.from(atob(value), (ch) => ch.charCodeAt(0));
        } catch {
            return [];
        }
    }
    return value;
});

const zMember = z.object({
    meetingId: zAccount,
    account: zAccount,
    wrap: zBytes,
});

const zMeeting = z.object({
    id: zAccount,
    host: zAccount,
    keyHash: z.string(),
});

const zUserKey = z.object({
    user: zAccount,
    key: zBytes,
});

export type Meeting = z.infer<typeof zMeeting>;
export type MeetingMember = z.infer<typeof zMember>;

export const getUserKey = async (account: string) => {
    const data = await graphql<{ userKey: unknown }>(
        `{ userKey(account: "${account}") { user key } }`,
        { service: MEET },
    );
    if (!data.userKey) return null;
    return zUserKey.parse(data.userKey);
};

export const getMeeting = async (id: string) => {
    const data = await graphql<{ meeting: unknown }>(
        `{ meeting(id: "${id}") { id host keyHash } }`,
        { service: MEET },
    );
    if (!data.meeting) return null;
    return zMeeting.parse(data.meeting);
};

export const getMeetingByHash = async (hash: string) => {
    const data = await graphql<{ meetingByHash: unknown }>(
        `{ meetingByHash(hash: "${hash}") { id host keyHash } }`,
        { service: MEET },
    );
    if (!data.meetingByHash) return null;
    return zMeeting.parse(data.meetingByHash);
};

export const getMeetingMembers = async (meetingId: string) => {
    const data = await graphql<{
        meetingMembers: { nodes: unknown[] };
    }>(
        `{ meetingMembers(meetingId: "${meetingId}", first: 100) { nodes { meetingId account wrap } } }`,
        { service: MEET },
    );
    return z.array(zMember).parse(data.meetingMembers.nodes);
};

export const getMeetingsForAccount = async (account: string) => {
    const data = await graphql<{
        meetingsForAccount: { nodes: unknown[] };
    }>(
        `{ meetingsForAccount(account: "${account}", first: 100) { nodes { meetingId account wrap } } }`,
        { service: MEET },
    );
    return z.array(zMember).parse(data.meetingsForAccount.nodes);
};
