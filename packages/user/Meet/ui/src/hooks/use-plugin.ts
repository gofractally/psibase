import { supervisor } from "@shared/lib/supervisor";

const SERVICE = "meet";

export const meetPlugin = {
    setKey: () =>
        supervisor.functionCall({
            service: SERVICE,
            intf: "api",
            method: "setKey",
            params: [],
        }),
    rotateKey: () =>
        supervisor.functionCall({
            service: SERVICE,
            intf: "api",
            method: "rotateKey",
            params: [],
        }),
    setMeeting: (id: string, accounts: string[]) =>
        supervisor.functionCall({
            service: SERVICE,
            intf: "api",
            method: "setMeeting",
            params: [id, accounts],
        }) as Promise<unknown>,
    wrapMember: (meetingId: string, account: string) =>
        supervisor.functionCall({
            service: SERVICE,
            intf: "api",
            method: "wrapMember",
            params: [meetingId, account],
        }),
    meetingPassword: (meetingId: string) =>
        supervisor.functionCall({
            service: SERVICE,
            intf: "api",
            method: "meetingPassword",
            params: [meetingId],
        }) as Promise<string>,
    addMembers: (meetingId: string, accounts: string[]) =>
        supervisor.functionCall({
            service: SERVICE,
            intf: "api",
            method: "addMembers",
            params: [meetingId, accounts],
        }),
    removeMembers: (meetingId: string, accounts: string[]) =>
        supervisor.functionCall({
            service: SERVICE,
            intf: "api",
            method: "removeMembers",
            params: [meetingId, accounts],
        }),
    deleteMeeting: (meetingId: string) =>
        supervisor.functionCall({
            service: SERVICE,
            intf: "api",
            method: "deleteMeeting",
            params: [meetingId],
        }),
};
