export type TransferPrefill = {
    payee?: string;
    amount?: string;
    fromAsset?: number;
    toAsset?: number;
    requestId?: number;
    /** Asset symbol. When it matches, both sides use it instead of the page currency. */
    currency?: string;
};

export function transferPrefillFromSearch(
    params: URLSearchParams,
): TransferPrefill | null {
    const requestId = Number(params.get("request") || "") || 0;
    const payee = params.get("payee")?.trim() || undefined;
    if (!requestId && !payee) return null;
    const fromAsset = Number(params.get("fromAsset") || "") || 0;
    const toAsset = Number(params.get("toAsset") || "") || 0;
    const currency = params.get("currency")?.trim() || undefined;
    return {
        payee,
        amount: params.get("amount") || undefined,
        fromAsset: fromAsset > 0 ? fromAsset : undefined,
        toAsset: toAsset > 0 ? toAsset : undefined,
        requestId: requestId || undefined,
        currency,
    };
}

export function assetIdBySymbol(
    symbol: string | undefined,
    assets: { id: number; symbol: string }[],
): number | undefined {
    const want = symbol?.trim().toUpperCase();
    if (!want) return undefined;
    return assets.find((a) => a.symbol.toUpperCase() === want)?.id;
}

/** Link that opens Transfer filled in for this payee, amount, and currency. */
export function transferSuggestUrl(
    payee: string,
    amount: string,
    currency: string,
): string | null {
    const who = payee.trim();
    const amt = amount.trim();
    const cur = currency.trim().toUpperCase();
    if (!who || !cur) return null;
    if (!/^\d+(\.\d*)?$|^\.\d+$/.test(amt)) return null;
    const n = Number(amt);
    if (!Number.isFinite(n) || n <= 0) return null;
    const q = new URLSearchParams({
        payee: who,
        amount: amt,
        currency: cur,
    });
    return new URL(`/accounts?${q.toString()}`, window.location.origin).href;
}
