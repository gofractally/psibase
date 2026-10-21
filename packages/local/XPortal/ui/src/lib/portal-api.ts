import { z } from "zod";

import { uint8ArrayToHex } from "@psibase/common-lib";

import type { InviteDetails } from "./signup-request";

const zStatus = z.object({
    requests_enabled: z.boolean(),
    ready: z.boolean(),
});

const zSignupReceipt = z.object({ signup_id: z.string() });

const zSignupView = z.discriminatedUnion("state", [
    z.object({ state: z.literal("queued") }),
    z.object({ state: z.literal("invited"), token: z.string() }),
    z.object({ state: z.literal("failed") }),
]);

/** The node refused the request. `status` is the HTTP status. */
export class PortalError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

export const parseReply = async <T>(
    reply: Promise<Response>,
    schema: z.ZodType<T>,
): Promise<T> => {
    const res = await reply;
    if (!res.ok) {
        throw new PortalError(res.status, (await res.text()).trim());
    }
    return schema.parse(await res.json());
};

export const isRequestsOpen = async (): Promise<boolean> => {
    const status = await parseReply(fetch("/status"), zStatus);
    return status.requests_enabled && status.ready;
};

/** Asks the node to create a prepared invite. Returns the new signup's id. */
export const requestSignup = async (invite: InviteDetails): Promise<string> => {
    const reply = fetch("/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            invite_id: invite.inviteId,
            payload: uint8ArrayToHex(invite.payload),
            token: invite.inviteToken,
        }),
    });
    return (await parseReply(reply, zSignupReceipt)).signup_id;
};

export const getSignup = (signupId: string) =>
    parseReply(fetch(`/signup/${encodeURIComponent(signupId)}`), zSignupView);

const zXIdentity = z.object({ x_id: z.string(), handle: z.string() });

export type XIdentity = z.infer<typeof zXIdentity>;

export const xIdentityQueryKey = ["x-identity"] as const;

/** The signed-in X user, or `null` when no one is signed in. */
export const getXIdentity = async (): Promise<XIdentity | null> => {
    const res = await fetch("/me");
    if (res.status === 401) return null;
    if (!res.ok) {
        throw new PortalError(res.status, (await res.text()).trim());
    }
    return zXIdentity.parse(await res.json());
};

export const signOutOfX = async (): Promise<void> => {
    const res = await fetch("/auth/logout", { method: "POST" });
    if (!res.ok) {
        throw new PortalError(res.status, (await res.text()).trim());
    }
};
