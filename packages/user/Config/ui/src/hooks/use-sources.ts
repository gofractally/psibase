import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { Account, zAccount } from "@/lib/zod/Account";

const zPackageSourcee = z
    .object({
        url: z.string().optional(),
        account: zAccount.optional(),
    })
    .strict();

export type PackageSource = z.infer<typeof zPackageSourcee>;

export const useSources = (owner: string | null | undefined) =>
    useQuery<PackageSource[], Error, Account>({
        queryKey: QueryKey.sources(),
        enabled: !!owner,
        queryFn: async () => {
            const res = await supervisor.functionCall({
                service: "packages",
                plugin: "plugin",
                intf: "queries",
                method: "getSources",
                params: [owner],
            });

            return zPackageSourcee.array().parse(res);
        },
    });
