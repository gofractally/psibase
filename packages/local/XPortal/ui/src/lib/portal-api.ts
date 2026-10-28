import { z } from "zod";

import { uint8ArrayToHex } from "@psibase/common-lib";
import {
    toSystemTokenInfo,
    type SystemTokenInfo,
} from "@shared/hooks/use-system-token";
import { supervisor } from "@shared/lib/supervisor";

import type { InviteDetails } from "./signup-request";

const zStatus = z.object({
    requests_enabled: z.boolean(),
    ready: z.boolean(),
});

const zSignupReceipt = z.union([
    z.object({
        signup_id: z.string(),
        client_secret: z.string(),
        publishable_key: z.string(),
    }),
    z.object({ signup_id: z.string() }),
]);

/** A paid tier's receipt carries what Stripe Embedded Checkout needs. */
export type SignupReceipt = z.infer<typeof zSignupReceipt>;

// The node sends u64 as a JSON string. A number is accepted so a small
// value that arrives unquoted still parses.
export const zU64 = z
    .union([z.string(), z.number()])
    .transform((value): string => String(value));

export const zQuantity = z.object({ value: zU64 });

const zTierOffer = z.object({
    usd_cents: z.coerce.number(),
    tokens: zQuantity,
    buffer_multiple: z.coerce.number(),
});

const zTiers = z.object({
    free: zTierOffer.nullish(),
    tiers: z.array(
        zTierOffer.extend({ index: z.number(), label: z.string() }),
    ),
});

export type Tiers = z.infer<typeof zTiers>;

const zSystemToken = z.object({
    id: z.coerce.number(),
    symbol: z.string().nullish(),
    precision: z.coerce.number().int().nonnegative(),
});

/**
 * The chain's system token, used to format tier grants.
 * `null` when the chain has no system token. A token with no symbol
 * displays as `ID: {id}`, the same rule as `toSystemTokenInfo`.
 */
export const getSystemToken = async (): Promise<SystemTokenInfo | null> => {
    const raw: unknown = await supervisor.functionCall({
        service: "tokens",
        intf: "helpers",
        method: "getSystemToken",
        params: [],
    });
    if (raw == null) return null;
    const token = zSystemToken.parse(raw);
    return toSystemTokenInfo({
        id: token.id,
        precision: token.precision,
        symbol: token.symbol ?? undefined,
    });
};

/** `raw` is an amount in smallest units of a token with `precision`. */
export const formatUnits = (raw: string, precision: number) => {
    const digits = precision === 0 ? raw : raw.padStart(precision + 1, "0");
    const cut = digits.length - precision;
    const whole = digits.slice(0, cut).replace(/^0+(?=\d)/, "");
    const frac = precision === 0 ? "" : digits.slice(cut).replace(/0+$/, "");
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return frac ? `${grouped}.${frac}` : grouped;
};

/** e.g. `$1,250.00`. */
export const formatUsdCents = (cents: number) =>
    (cents / 100).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
    });

/** `raw` is the grant in the token's smallest units. */
export const formatTokenAmount = (raw: string, token: SystemTokenInfo) =>
    `${formatUnits(raw, token.precision)} ${token.symbol}`;

const zSignupView = z.discriminatedUnion("state", [
    z.object({ state: z.literal("pending") }),
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

export const errorText = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

export const parseReply = async <T>(
    reply: Promise<Response>,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
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

export const getTiers = () => parseReply(fetch("/tiers"), zTiers);

/** Asks the node to create a prepared invite. `tier` is unset for the free tier. */
export const requestSignup = (
    invite: InviteDetails,
    tier: number | undefined,
): Promise<SignupReceipt> =>
    parseReply(
        fetch("/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                invite_id: invite.inviteId,
                payload: uint8ArrayToHex(invite.payload),
                token: invite.inviteToken,
                tier,
            }),
        }),
        zSignupReceipt,
    );

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
