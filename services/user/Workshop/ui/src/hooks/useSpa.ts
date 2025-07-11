import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { Account } from "@/lib/zodTypes";

import { toast } from "@shared/shadcn/ui/sonner";

import { SiteConfigResponse, siteConfigQueryKey } from "./useSiteConfig";

const Params = z.object({
    account: Account,
    enableSpa: z.boolean(),
});

export const useSpa = () =>
    useMutation<null, Error, z.infer<typeof Params>>({
        mutationKey: ["spa"],
        mutationFn: async (params) => {
            const { account, enableSpa } = Params.parse(params);

            await supervisor.functionCall({
                method: "enableSpa",
                params: [account, enableSpa],
                service: "workshop",
                intf: "app",
            });

            return null;
        },
        onSuccess: (_, { account, enableSpa }) => {
            toast.success(
                `${enableSpa ? "Enabled" : "Disabled"} SPA on ${account}`,
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
                                spa: enableSpa,
                            },
                        };
                        return SiteConfigResponse.parse(newData);
                    }
                },
            );
        },
    });
