import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { queryClient } from "@shared/lib/queryClient";
import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

import { SiteConfigResponse, siteConfigQueryKey } from "./use-site-config";

const Params = z.object({
    account: zAccount,
    path: z.string(),
});

export const useRemovePath = () =>
    useMutation<void, Error, z.infer<typeof Params>>({
        mutationKey: ["removePath"],
        mutationFn: async (par) => {
            const { account, path } = Params.parse(par);
            const params = [account, path];

            const args = {
                method: "remove",
                params,
                service: "workshop",
                intf: "app",
            };

            await supervisor.functionCall(args);
        },
        onSuccess: (_, { account, path }) => {
            toast.success(`Removed ${path} from ${account}`);

            // Update the existing query data to remove the path from the site config files
            queryClient.setQueryData(
                siteConfigQueryKey(account),
                (data: unknown) => {
                    if (data) {
                        const parsed = SiteConfigResponse.parse(data);

                        const updated: z.infer<typeof SiteConfigResponse> = {
                            ...parsed,
                            getContent: {
                                ...parsed.getContent,
                                edges: parsed.getContent.edges.filter(
                                    (edge) => edge.node.path !== path,
                                ),
                            },
                        };
                        return SiteConfigResponse.parse(updated);
                    }
                },
            );

            queryClient.invalidateQueries({
                queryKey: siteConfigQueryKey(account),
            });
        },
    });
