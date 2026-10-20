import { z } from "zod";

import { supervisor } from "@shared/lib/supervisor";

import { parseReply, PortalError } from "./portal-api";

const zAllowedAction = z.object({
    service: z.string(),
    method: z.string(),
});

const zAdminConfig = z.object({
    requests_enabled: z.boolean(),
    producer: z.string().nullish(),
    account: z.string().nullish(),
    creator_pubkey: z.string().nullish(),
    creator_allowed: z.array(zAllowedAction),
});

const zPortalStatus = z.object({
    requests_enabled: z.boolean(),
    billing_enabled: z.boolean(),
    conditions: z.array(
        z.object({
            id: z.string(),
            ok: z.boolean(),
        }),
    ),
});

const zFailedSignup = z.object({
    id: z.string(),
    created: z.string(),
    attempts: z.number(),
    last_error: z.string(),
});

const zAgentKey = z.object({
    pubkey: z.string(),
});

export type AllowedAction = z.infer<typeof zAllowedAction>;
export type AdminConfig = z.infer<typeof zAdminConfig>;
export type PortalStatus = z.infer<typeof zPortalStatus>;
export type FailedSignup = z.infer<typeof zFailedSignup>;

export type CreatorKey = {
    /** `ac-creator` is already on chain. Keygen returns 409 in that case. */
    accountExists: boolean;
    pubkey: string | null;
};

export const getAdminConfig = () =>
    parseReply(fetch("/admin/config"), zAdminConfig);

export const putRequestsEnabled = async (requestsEnabled: boolean) => {
    const res = await fetch("/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests_enabled: requestsEnabled }),
    });
    if (!res.ok) {
        throw new PortalError(res.status, (await res.text()).trim());
    }
};

export const getPortalStatus = () =>
    parseReply(fetch("/status"), zPortalStatus);

export const getFailedSignups = () =>
    parseReply(
        fetch("/admin/signups?state=failed"),
        z.array(zFailedSignup),
    );

/** Returns the stored creator key, creating it when the account does not exist yet. */
export const loadCreatorKey = async (): Promise<CreatorKey> => {
    const res = await fetch("/admin/agents/creator/keygen", {
        method: "POST",
    });
    if (res.status === 409) {
        return { accountExists: true, pubkey: null };
    }
    if (!res.ok) {
        throw new PortalError(res.status, (await res.text()).trim());
    }
    return {
        accountExists: false,
        pubkey: zAgentKey.parse(await res.json()).pubkey,
    };
};

/** The signed-in producer creates `ac-creator`, owned by `owner`, for `pubkeyPem`, with auto-debit on. */
export const createAdminAccounts = (args: {
    pubkeyPem: string;
    owner: string;
    allowed: AllowedAction[];
}) =>
    supervisor.functionCall({
        service: "x-portal",
        plugin: "plugin",
        intf: "api",
        method: "createAdminAccounts",
        params: [args.pubkeyPem, args.owner, args.allowed],
    });
