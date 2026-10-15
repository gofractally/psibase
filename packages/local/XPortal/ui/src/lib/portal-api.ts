import { z } from "zod";

const zStatus = z.object({
    requests_enabled: z.boolean(),
    ready: z.boolean(),
});

const zSignupReceipt = z.object({ signup_id: z.string() });

const zSignupView = z.object({
    state: z.enum(["queued", "created", "failed"]),
});

/** The node refused the request. `status` is the HTTP status. */
export class PortalError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

const parseReply = async <T>(
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

/** Returns the new signup's id. */
export const requestSignup = async (
    name: string,
    pubkeyPem: string,
): Promise<string> => {
    const reply = fetch("/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, pubkey_pem: pubkeyPem }),
    });
    return (await parseReply(reply, zSignupReceipt)).signup_id;
};

export const getSignup = (signupId: string) =>
    parseReply(fetch(`/signup/${encodeURIComponent(signupId)}`), zSignupView);
