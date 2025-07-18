import { useQuery } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import { Account } from "@/lib/zod/Account";

export const useConnectedAccounts = () =>
    useQuery({
        queryKey: ["connectedAccounts"],
        initialData: [],
        queryFn: async () =>
            Account.array().parse(
                await supervisor.functionCall({
                    method: "getConnectedAccounts",
                    params: [],
                    service: "accounts",
                    intf: "activeApp",
                }),
            ),
    });
