import { z } from "zod";

import { supervisor } from "@shared/lib/supervisor";

import { parseReply, PortalError, zQuantity, zU64 } from "./portal-api";

const zAllowedAction = z.object({
    service: z.string(),
    method: z.string(),
});

const zStripeKeys = z.object({
    secret_key: z.string().nullish(),
    publishable_key: z.string().nullish(),
    webhook_secret: z.string().nullish(),
});

const zStripeMode = z.enum(["sandbox", "production"]);

export type StripeKeys = z.infer<typeof zStripeKeys>;

const zPricingBasis = z.object({
    precision: z.number().int().nonnegative(),
    /** The system token's issued minus burned supply. */
    supply: zQuantity,
    std_buffer_cost: zQuantity,
});

const zAdminConfig = z.object({
    requests_enabled: z.boolean(),
    /** USD micros per whole system token. */
    price_per_token_usd_micros: zU64.nullish(),
    free_tier: z.object({
        enabled: z.boolean(),
        usd_cents: z.coerce.number().nullish(),
    }),
    /** Set while billing is enabled. */
    pricing_basis: zPricingBasis.nullish(),
    tiers: z.array(
        z.object({ label: z.string(), usd_cents: z.coerce.number() }),
    ),
    producer: z.string().nullish(),
    account: z.string().nullish(),
    creator_pubkey: z.string().nullish(),
    creator_allowed: z.array(zAllowedAction),
    /** Secrets show only their last four characters. */
    x: z.object({
        client_id: z.string().nullish(),
        client_secret: z.string().nullish(),
    }),
    x_callback_url: z.string(),
    mode: zStripeMode,
    stripe: z.object({
        sandbox: zStripeKeys,
        production: zStripeKeys,
    }),
});

const zPortalStatus = z.object({
    requests_enabled: z.boolean(),
    billing_enabled: z.boolean(),
    mode: zStripeMode,
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
export type PricingBasis = z.infer<typeof zPricingBasis>;
export type AdminConfig = z.infer<typeof zAdminConfig>;

/** Pricing as `PUT /admin/config` takes it. The price is a u64 string. */
export type PricingPatch = {
    price_per_token_usd_micros: string;
    free_tier: { enabled: boolean; usd_cents: number };
    tiers: { label: string; usd_cents: number }[];
};
export type PortalStatus = z.infer<typeof zPortalStatus>;
export type FailedSignup = z.infer<typeof zFailedSignup>;

export type CreatorKey = {
    /** `ac-creator` is already on chain. Keygen returns 409 in that case. */
    accountExists: boolean;
    pubkey: string | null;
};

export const getAdminConfig = () =>
    parseReply(fetch("/admin/config"), zAdminConfig);

/** Sets each field `patch` carries. */
export const putAdminConfig = async (
    patch: {
        requests_enabled?: boolean;
        mode?: AdminConfig["mode"];
        x?: Record<string, string>;
        stripe?: {
            sandbox?: Record<string, string>;
            production?: Record<string, string>;
        };
    } & Partial<PricingPatch>,
) => {
    const res = await fetch("/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
    });
    if (!res.ok) {
        throw new PortalError(res.status, (await res.text()).trim());
    }
};

export const putRequestsEnabled = (requestsEnabled: boolean) =>
    putAdminConfig({ requests_enabled: requestsEnabled });

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
