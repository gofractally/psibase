import type { Asset } from "@/lib/graphql";

/** Prefer USD; otherwise first listed asset. */
export function defaultAssetId(assets: Asset[]): number | undefined {
    if (assets.length === 0) return undefined;
    const usd = assets.find(
        (a) => a.symbol === "USD" || a.symbol.toLowerCase() === "usd",
    );
    return (usd ?? assets[0]).id;
}
