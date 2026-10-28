import { getSupervisor, siblingUrl } from "@psibase/common-lib";

export const BANX_SERVICE = "banx-app";

export type BanxAsset = {
    id: number;
    symbol: string;
    precision: number;
};

export type BanxCreditLine = {
    creditor: string;
    debtor: string;
    assetId: number;
};

export type PathHop = {
    account: string;
    assetId: number;
};

export type PathQuote = {
    hops: PathHop[];
    amountIn: string;
    amountOut: string;
    minReturn: string;
};

type GqlErrors = { errors?: { message?: string }[] };

async function banxGraphql<T>(query: string): Promise<T> {
    const host = siblingUrl(null, BANX_SERVICE, null);
    const res = await fetch(`${host}/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
    });
    const body = (await res.json()) as GqlErrors & { data?: T };
    if (body.errors?.length) {
        throw new Error(body.errors[0]?.message ?? "Banx GraphQL error");
    }
    if (!res.ok || body.data === undefined) {
        throw new Error(`Banx GraphQL failed (${res.status})`);
    }
    return body.data;
}

export async function fetchBanxAssets(): Promise<BanxAsset[]> {
    const data = await banxGraphql<{
        assets: { id: number; symbol: string; precision: number }[];
    }>(`{ assets { id symbol precision } }`);
    return (data.assets ?? []).map((a) => ({
        id: Number(a.id),
        symbol: String(a.symbol).toUpperCase(),
        precision: Number(a.precision),
    }));
}

export async function fetchBanxCreditLines(
    account: string,
): Promise<BanxCreditLine[]> {
    const data = await banxGraphql<{
        creditLines: {
            creditor: string;
            debtor: string;
            assetId: number;
        }[];
    }>(
        `{ creditLines(account: "${account}") { creditor debtor assetId } }`,
    );
    return (data.creditLines ?? []).map((l) => ({
        creditor: String(l.creditor),
        debtor: String(l.debtor),
        assetId: Number(l.assetId),
    }));
}

/** Assets on which `account` has any credit line (creditor or debtor). */
export async function fetchMyBanxAssets(
    account: string,
): Promise<BanxAsset[]> {
    const [lines, assets] = await Promise.all([
        fetchBanxCreditLines(account),
        fetchBanxAssets(),
    ]);
    const ids = new Set(lines.map((l) => l.assetId));
    return assets.filter((a) => ids.has(a.id));
}

async function banxPluginCall(method: string, params: unknown[]): Promise<unknown> {
    // Match Banx UI: service + intf "api" (plugin resolved by supervisor).
    return getSupervisor().functionCall({
        service: BANX_SERVICE,
        intf: "api",
        method,
        params,
    });
}

export async function quotePath(p: {
    fromAccount: string;
    toAccount: string;
    amount: string;
    fromAsset: number;
    toAsset: number;
    maxHops?: number;
    exactOut?: boolean;
}): Promise<PathQuote> {
    const exactOut = p.exactOut === true;
    const res = (await banxPluginCall("quotePath", [
        p.fromAccount,
        p.toAccount,
        p.amount,
        p.fromAsset,
        p.toAsset,
        p.maxHops ?? 4,
        exactOut,
    ])) as Record<string, unknown> & {
        hops?: Record<string, unknown>[];
    };
    const hops = (res.hops ?? []).map((h) => ({
        account: String(h.account),
        assetId: Number(h.assetId ?? h.asset_id),
    }));
    const amountIn = String(res.amountIn ?? res.amount_in ?? p.amount);
    const amountOut = String(res.amountOut ?? res.amount_out ?? "");
    const minReturn = String(res.minReturn ?? res.min_return ?? amountOut);
    return { hops, amountIn, amountOut, minReturn };
}

export async function pathPay(p: {
    hops: PathHop[];
    amount: string;
    minReturn: string;
    requestId?: number;
}): Promise<void> {
    await banxPluginCall("pathPay", [
        p.hops.map((h) => ({ account: h.account, assetId: h.assetId })),
        p.amount,
        p.minReturn,
        p.requestId ?? 0,
    ]);
}

/**
 * Prompt for Banx High trust (covers Low quotePath + High pathPay) before play.
 * Uses an empty path so assert_authorized runs, then the plugin rejects without
 * submitting a transaction.
 */
export async function ensureBanxGameplayAuth(): Promise<void> {
    try {
        await banxPluginCall("pathPay", [[], "0", "0", 0]);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/at least one hop/i.test(msg)) return;
        throw e instanceof Error ? e : new Error(msg);
    }
}
