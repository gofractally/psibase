import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/query-keys";
import { PackageSchema } from "@/lib/zod/common-package";

import { supervisor } from "@shared/lib/supervisor";

export const zPackageSchemaWithSha = PackageSchema.extend({
    file: z.string(),
    sha256: z.string(),
});

export type PackageSchemaWithSha = z.infer<typeof zPackageSchemaWithSha>;

export const useAvailablePackages = () =>
    useQuery({
        queryKey: QueryKey.availablePackages(),
        queryFn: async () => {
            const res = await supervisor.functionCall({
                service: "packages",
                intf: "queries",
                method: "getAvailablePackages",
                params: ["root"],
            });

            return zPackageSchemaWithSha.array().parse(res);
        },
    });
