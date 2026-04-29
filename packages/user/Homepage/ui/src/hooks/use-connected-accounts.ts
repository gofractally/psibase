import { useQuery } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";

import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";

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
