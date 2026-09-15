import { z } from "zod";

import { supervisor } from "@shared/lib/supervisor";

const TOKEN_KEY = (id: number) => `banx.invite.token.${id}`;
const RECIPROCAL_KEY = "banx.invite.reciprocal";
const NICK_DISMISS_KEY = (id: number) => `banx.invite.nick.dismiss.${id}`;

/** Terms of the line just received, used to prefill "line them back". */
export type PendingReciprocal = {
    inviter: string;
    assetId: number;
    limit: string;
    depleteOnDebit: boolean;
    interestRatePpm: number;
    graceSeconds: number;
};

const zPendingReciprocal = z.object({
    inviter: z.string().min(1),
    assetId: z.number().int().nonnegative(),
    limit: z.string().min(1),
    depleteOnDebit: z.boolean(),
    interestRatePpm: z.number().int().nonnegative(),
    graceSeconds: z.number().int().nonnegative(),
});

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

export function rememberPendingReciprocal(terms: PendingReciprocal) {
    try {
        sessionStorage.setItem(RECIPROCAL_KEY, JSON.stringify(terms));
    } catch {
        // private mode / quota
    }
}

export function peekPendingReciprocal(): PendingReciprocal | null {
    try {
        const raw = sessionStorage.getItem(RECIPROCAL_KEY);
        if (!raw) return null;
        const parsed = zPendingReciprocal.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

export function forgetPendingReciprocal() {
    try {
        sessionStorage.removeItem(RECIPROCAL_KEY);
    } catch {
        // ignore
    }
}

export function dismissInviteNickname(id: number) {
    try {
        localStorage.setItem(NICK_DISMISS_KEY(id), "1");
    } catch {
        // ignore
    }
}

export function isInviteNicknameDismissed(id: number): boolean {
    try {
        return localStorage.getItem(NICK_DISMISS_KEY(id)) === "1";
    } catch {
        return false;
    }
}
