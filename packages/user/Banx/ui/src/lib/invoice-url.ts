import { displayAmount } from "@/lib/amount";
import type { PayRequest } from "@/lib/graphql";

export function invoicePaySearch(r: PayRequest): URLSearchParams {
    return new URLSearchParams({
        request: String(r.id),
        payee: r.poster,
        toAsset: String(r.assetId),
        amount: displayAmount(r.remaining),
    });
}

/** Absolute Transfer URL a payer can open (or scan) to pay this invoice. */
export function invoicePayUrl(r: PayRequest): string {
    return new URL(
        `/path-pay?${invoicePaySearch(r).toString()}`,
        window.location.origin,
    ).href;
}
