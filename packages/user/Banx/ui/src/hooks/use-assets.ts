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
    const { data: assets = [], ...rest } = useAssets();
    const byId = new Map(assets.map((a) => [a.id, a]));
    const symbolOf = (id: number) => byId.get(id)?.symbol ?? `#${id}`;
    const precisionOf = (id: number) => byId.get(id)?.precision ?? 0;
    return { assets, byId, symbolOf, precisionOf, ...rest };
}
