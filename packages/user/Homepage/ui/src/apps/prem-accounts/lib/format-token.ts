import { Quantity } from "@shared/lib/quantity";

export function unitTokenDecimal(precision: number): string {
    return new Quantity(1, precision, 0).format({
        fullPrecision: true,
        includeLabel: false,
        showThousandsSeparator: false,
    });
}

export function formatCanonicalPrice(
    canonical: string,
    precision: number,
    tokenId: number,
    symbol?: string | null,
): string {
    return new Quantity(canonical, precision, tokenId, symbol).format({
        fullPrecision: true,
        includeLabel: true,
        showThousandsSeparator: false,
    });
}
