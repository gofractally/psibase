import { useQuery } from "@tanstack/react-query";

import { PackageSource, getSources } from "@/lib/get-sources";
import QueryKey from "@/lib/query-keys";

export const useSources = () =>
    useQuery<PackageSource[], Error>({
        queryKey: QueryKey.sources(),
        queryFn: async () => {
            return getSources();
        },
    });
