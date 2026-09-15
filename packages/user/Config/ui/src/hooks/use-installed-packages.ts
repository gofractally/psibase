import { useQuery } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";
import { PackageSchema } from "@/lib/zod/common-package";

import { callPluginFunction, config } from "@shared/lib/plugins";

export const useInstalledPackages = () =>
    useQuery({
        queryKey: QueryKey.installedPackages(),
        queryFn: async () => {
            const result = await callPluginFunction(
                config.packaging.getInstalledPackages,
                [],
            );
            return PackageSchema.array().parse(result);
        },
    });
