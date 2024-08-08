import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { getJson } from "@psibase/common-lib";
import { PackageInfo } from "@/types";

export const usePackages = () =>
    useQuery<PackageInfo[]>({
        queryKey: queryKeys.packages,
        queryFn: () => getJson("/packages/index.json"),
        initialData: [],
    });
