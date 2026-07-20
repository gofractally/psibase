import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { zMetadata } from "@/lib/zod-types";

import { queryClient } from "@shared/lib/query-client";
import { zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";

import { MetadataResponse, appMetadataQueryKey } from "./use-app-metadata";

const Params = z.object({
    metadata: zMetadata,
    account: zAccount,
});

export const useSetMetadata = () =>
    useMutation<null, Error, z.infer<typeof Params>>({
        mutationKey: ["setMetdata"],
        mutationFn: async (params) => {
            const { metadata, account } = Params.parse(params);
            await supervisor.functionCall({
                method: "setAppMetadata",
                params: [account, metadata],
                service: "workshop",
                intf: "registry",
            });
            return null;
        },
        onSuccess: (_, { account, metadata }) => {
            queryClient.setQueryData(
                appMetadataQueryKey(account),
                (updater: unknown) => {
                    if (updater) {
                        const oldData =
                            MetadataResponse.shape.appMetadata.parse(updater);
                        if (oldData) {
                            return {
                                accountId: oldData.accountId,
                                status: oldData.status,
                                createdAt: oldData.createdAt,
                                ...metadata,
                            };
                        }
                    }
                },
            );
            queryClient.refetchQueries({
                queryKey: appMetadataQueryKey(account),
            });
        },
    });
