import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

const zPackageSource = z
    .object({
        url: z.string().optional(),
        account: zAccount.optional(),
    })
    .strict();

export type PackageSource = z.infer<typeof zPackageSource>;

export const useSources = () =>
    useQuery<PackageSource[], Error>({
        queryKey: QueryKey.sources(),
        queryFn: async () => {
            const res = await supervisor.functionCall({
                service: "packages",
                intf: "queries",
                method: "getSources",
                params: ["root"],
            });

            return zPackageSource.array().parse(res);
        },
    });
