import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { zAccount } from "@/lib/zod/Account";

export const useCanExportAccount = (account?: string | null) =>
    useQuery({
        queryKey: ["account", account],
        enabled: Boolean(account),
        queryFn: async () => {
            const response = await supervisor.functionCall({
                service: "accounts",
                plugin: "plugin",
                intf: "api",
                method: "getAccount",
                params: [zAccount.parse(account)],
            });

            const accountInfo = z
                .object({
                    accountNum: z.string(),
                    authService: zAccount,
                    resourceBalance: z.bigint(),
                })
                .parse(response);

            return accountInfo.authService === "auth-sig";
        },
    });
