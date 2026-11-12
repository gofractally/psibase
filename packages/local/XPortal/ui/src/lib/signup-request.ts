import { z } from "zod";

import { supervisor } from "@shared/lib/supervisor";

import { requestSignup, type SignupReceipt } from "./portal-api";

const SIGNUP_ID_KEY = "x-portal-signup-id";

const zInviteDetails = z.object({
    inviteToken: z.string(),
    inviteId: z.number(),
    payload: z.instanceof(Uint8Array),
});

/** The Invite plugin's `prepare-new-invite` result. */
export type InviteDetails = z.infer<typeof zInviteDetails>;

/**
 * Prepares an invite in this browser and asks the node to create it for
 * `tier`, unset for the free tier. Throws `PortalError` when the node refuses.
 */
export const startSignup = async (
    tier: number | undefined,
): Promise<SignupReceipt> => {
    const invite = zInviteDetails.parse(
        await supervisor.functionCall({
            service: "invite",
            intf: "inviter",
            method: "prepareNewInvite",
            params: [],
        }),
    );
    return requestSignup(invite, tier);
};

/** Keeps the signup id for this tab so a reload resumes the signup. */
export const rememberSignup = (signupId: string) =>
    sessionStorage.setItem(SIGNUP_ID_KEY, signupId);

/** Makes the created invite active for x-portal, so the host login prompt offers account creation. */
export const importInvite = (token: string) =>
    supervisor.functionCall({
        service: "invite",
        intf: "invitee",
        method: "importInviteToken",
        params: [token],
    });

export const storedSignupId = () => sessionStorage.getItem(SIGNUP_ID_KEY);

export const forgetSignup = () => sessionStorage.removeItem(SIGNUP_ID_KEY);
