import { useQuery } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import QueryKey from "@/lib/queryKeys";
import { zAccount } from "@/lib/zod/Account";

export const useConnectedAccounts = () =>
    useQuery({
        queryKey: QueryKey.connectedAccounts(),
        initialData: [],
        queryFn: async () =>
            zAccount.array().parse(
                await supervisor.functionCall({
                    method: "getConnectedAccounts",
                    params: [],
                    service: "accounts",
                    intf: "activeApp",
                }),
            ),
    });
