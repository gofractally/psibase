import { z } from "zod";

import { supervisor } from "@shared/lib/supervisor";

const TOKEN_KEY = (id: number) => `banx.invite.token.${id}`;

export function inviteClaimUrl(token: string): string {
    return new URL(
        `/invite?token=${encodeURIComponent(token)}`,
        window.location.origin,
    ).href;
}

export function rememberInviteToken(id: number, token: string) {
    try {
        localStorage.setItem(TOKEN_KEY(id), token);
    } catch {
        // private mode / quota
    }
}

export function recalledInviteToken(id: number): string | undefined {
    try {
        return localStorage.getItem(TOKEN_KEY(id)) ?? undefined;
    } catch {
        return undefined;
    }
}

export function forgetInviteToken(id: number) {
    try {
        localStorage.removeItem(TOKEN_KEY(id));
    } catch {
        // ignore
    }
}

export async function importInviteToken(token: string): Promise<number> {
    return z.number().int().parse(
        await supervisor.functionCall({
            service: "invite",
            intf: "invitee",
            method: "importInviteToken",
            params: [token],
        }),
    );
}

export async function rejectActiveInvite() {
    await supervisor.functionCall({
        service: "invite",
        intf: "invitee",
        method: "rejectActiveInvite",
        params: [],
    });
}
