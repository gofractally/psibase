import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { Account } from "@/lib/zodTypes";

import { toast } from "@shared/shadcn/ui/sonner";

import { SiteConfigResponse, siteConfigQueryKey } from "./useSiteConfig";

const Params = z.object({
    account: Account,
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
