import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { queryClient } from "@shared/lib/queryClient";
import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

import { SiteConfigResponse, siteConfigQueryKey } from "./use-site-config";

const Params = z.object({
    account: zAccount,
    enableCache: z.boolean(),
});

export const useSetCacheMode = () =>
    useMutation<null, Error, z.infer<typeof Params>>({
        mutationKey: ["cacheMode"],
        mutationFn: async (params) => {
            const { account, enableCache } = Params.parse(params);

            await supervisor.functionCall({
                method: "setCacheMode",
                params: [account, enableCache],
                service: "workshop",
                intf: "app",
            });

            return null;
        },
        onSuccess: (_, { account, enableCache }) => {
            toast.success(
                `${enableCache ? "Enabled" : "Disabled"} cache on ${account}`,
            );

            queryClient.setQueryData(
                siteConfigQueryKey(account),
                (data: unknown) => {
                    if (data) {
                        const parsed = SiteConfigResponse.parse(data);
                        const newData: z.infer<typeof SiteConfigResponse> = {
                            ...parsed,
                            getConfig: parsed.getConfig && {
                                ...parsed.getConfig,
                                cache: enableCache,
                            },
                        };
                        return SiteConfigResponse.parse(newData);
                    }
                },
            );
        },
    });
