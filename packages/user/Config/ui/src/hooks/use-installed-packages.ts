import { useQuery } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { PackageSchema } from "@/lib/zod/CommonPackage";

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
