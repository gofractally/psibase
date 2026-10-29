import type { AutoRedirectConfig } from "@psibase/common-lib";

import { z } from "zod";

import { supervisor } from "@shared/lib/supervisor";

import {
    formatUnits,
    parseReply,
    PortalError,
    zQuantity,
    zU64,
} from "./portal-api";

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

const zAdminSignup = z.object({
    id: z.string(),
    handle: z.string(),
    account: z.string().nullish(),
    /** Unset for the free tier. */
    tier: z.number().nullish(),
    state: z.string(),
    attempts: z.number(),
    last_error: z.string(),
    stripe_session_id: z.string().nullish(),
    created: z.string(),
});

const zAgentKey = z.object({
    pubkey: z.string(),
    pending_pubkey: z.string().nullish(),
});

const zAgent = z.object({
    account: z.string(),
    pubkey_pem: z.string(),
    psi_balance: zQuantity,
    resource_balance: zQuantity,
    /** One standard resource buffer, in the system token's smallest units. */
    std_buffer_cost: zQuantity,
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
export type AdminSignup = z.infer<typeof zAdminSignup>;
export type Agent = z.infer<typeof zAgent>;

export type CreatorKey = {
    pubkey: string;
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

export const adminSignupsKey = ["admin-signups"] as const;
export const adminConfigKey = ["admin-config"] as const;
export const portalStatusKey = ["portal-status"] as const;
export const agentsKey = ["admin-agents"] as const;

export type SignupListState = "invited" | "redeemed" | "failed";

/** Active-mode signups in `state`, newest first. */
export const getAdminSignups = (state: SignupListState) =>
    parseReply(
        fetch(`/admin/signups?state=${state}`),
        z.array(zAdminSignup),
    );

export const retrySignup = async (id: string) => {
    const res = await fetch(
        `/admin/signups/${encodeURIComponent(id)}/retry`,
        { method: "POST" },
    );
    if (!res.ok) {
        throw new PortalError(res.status, (await res.text()).trim());
    }
};

/** `ac-creator` on chain. 404 until the account exists. */
export const getAgents = () => parseReply(fetch("/admin/agents"), zAgent);

const postCreatorKeygen = async () => {
    const res = await fetch("/admin/agents/creator/keygen", {
        method: "POST",
    });
    if (!res.ok) {
        throw new PortalError(res.status, (await res.text()).trim());
    }
    return zAgentKey.parse(await res.json());
};

/** Returns the stored creator key, creating it when the account does not exist yet. */
export const loadCreatorKey = async (): Promise<CreatorKey> => ({
    pubkey: (await postCreatorKeygen()).pubkey,
});

/** Stores a pending creator key once `ac-creator` exists, or returns the one already stored. */
export const stageCreatorKey = async (): Promise<string> => {
    const pending = (await postCreatorKeygen()).pending_pubkey;
    if (!pending) {
        throw new PortalError(500, "creator key has no pending key");
    }
    return pending;
};

export const activateCreatorKey = async () => {
    const res = await fetch("/admin/agents/creator/activate", {
        method: "POST",
    });
    if (!res.ok) {
        throw new PortalError(res.status, (await res.text()).trim());
    }
};

const redirectToAdmin: AutoRedirectConfig = {
    enabled: true,
    returnPath: "/admin",
};

const callAdminPlugin = (method: string, params: unknown[]) =>
    supervisor.functionCall(
        {
            service: "x-portal",
            plugin: "plugin",
            intf: "api",
            method,
            params,
        },
        redirectToAdmin,
    );

/** The signed-in producer creates `ac-creator`, owned by `owner`, for `pubkeyPem`, with auto-debit on. */
export const createAdminAccounts = (args: {
    pubkeyPem: string;
    owner: string;
    allowed: AllowedAction[];
}) =>
    callAdminPlugin("createAdminAccounts", [
        args.pubkeyPem,
        args.owner,
        args.allowed,
    ]);

/** The signed-in admin credits `amount` of the system token to `ac-creator`. */
export const sendCreatorTokens = (amount: string) =>
    callAdminPlugin("sendTokens", [amount]);

/** The signed-in admin buys `amount` of resources for `ac-creator`. */
export const sendCreatorResources = (amount: string) =>
    callAdminPlugin("sendResources", [amount]);

/** The signed-in owner sets `ac-creator`'s key. `pubkeyPem` is the pending key. */
export const setCreatorKey = (pubkeyPem: string) =>
    callAdminPlugin("setCreatorKey", [pubkeyPem]);

/** Smallest-unit `raw` as a decimal the tokens plugin accepts. No grouping separators. */
export const formatDecimal = (raw: bigint, precision: number) =>
    formatUnits(raw.toString(), precision, false);

/** System tokens still needed to bring a resource buffer up to `100 * cost`. */
export const resourceTopUp = (balance: string, cost: string) => {
    const target = BigInt(cost) * 100n;
    const have = BigInt(balance);
    if (have >= target) return null;
    return target - have;
};
