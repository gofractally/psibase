import { useQuery } from "@tanstack/react-query";

import { getJson } from "@psibase/common-lib";

import { queryKeys } from "@/lib/queryKeys";
import { PackageInfo } from "@/types";

export const usePackages = () =>
    useQuery<PackageInfo[]>({
        queryKey: queryKeys.packages,
        queryFn: () => getJson("/packages/index.json"),
        initialData: [],
    });
