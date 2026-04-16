import { useQuery } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";
import { PackageSchema } from "@/lib/zod/common-package";

import { supervisor } from "@shared/lib/supervisor";

export const useInstalledPackages = () =>
    useQuery({
        queryKey: QueryKey.installedPackages(),
        queryFn: async () => {
            const result = await supervisor.functionCall({
                service: "packages",
                plugin: "plugin",
                intf: "queries",
                method: "getInstalledPackages",
                params: [],
            });
            return PackageSchema.array().parse(result);
        },
    });
