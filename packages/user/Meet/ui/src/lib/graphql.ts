import { supervisor } from "@shared/lib/supervisor";

const SERVICE = "meet";

const query = <T>(method: string, params: unknown[] = []) =>
    supervisor.functionCall({
        service: SERVICE,
        intf: "queries",
        method,
        params,
    }) as Promise<T>;

export type Meeting = {
    id: string;
    host: string;
    keyHash: string;
};

export type MeetingMember = {
    meetingId: string;
    account: string;
    wrapReady: boolean;
};

export const userHasKey = (account: string) =>
    query<boolean>("userHasKey", [account]);

export const getMeeting = (id: string) =>
    query<Meeting | null>("getMeeting", [id]);

export const getMeetingMembers = (meetingId: string) =>
    query<MeetingMember[]>("getMembers", [meetingId]);

export const getMyMeetings = () => query<MeetingMember[]>("getMyMeetings");
