import { useQuery } from "@tanstack/react-query";

import { PackageSource, getSources } from "@/lib/getSources";
import QueryKey from "@/lib/queryKeys";

export const useSources = () =>
    useQuery<PackageSource[], Error>({
        queryKey: QueryKey.sources(),
        queryFn: async () => {
            return getSources();
        },
    });
