import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchAssets } from "@/lib/graphql";
import { QueryKey } from "@/lib/query-keys";

export function useAssets() {
    return useQuery({
        queryKey: QueryKey.assets(),
        queryFn: fetchAssets,
        staleTime: 60_000,
    });
}

export function useAssetMap() {
    const { data: raw = [], ...rest } = useAssets();
    // Normalize symbols once so every consumer shows uppercase tickers.
    const assets = useMemo(
        () =>
            raw.map((a) => ({
                ...a,
                symbol: a.symbol.toUpperCase(),
            })),
        [raw],
    );
    const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
    const symbolOf = (id: number) => byId.get(id)?.symbol ?? `#${id}`;
    const precisionOf = (id: number) => byId.get(id)?.precision ?? 0;
    return { assets, byId, symbolOf, precisionOf, ...rest };
}
