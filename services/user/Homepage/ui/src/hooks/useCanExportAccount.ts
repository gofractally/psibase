import { Account } from "@/lib/zod/Account";
import { supervisor } from "@/supervisor";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

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
                params: [Account.parse(account)],
            });

            const accountInfo = z
                .object({
                    accountNum: z.string(),
                    authService: Account,
                    resourceBalance: z.bigint(),
                })
                .parse(response);

            return accountInfo.authService === "auth-sig";
        },
    });
