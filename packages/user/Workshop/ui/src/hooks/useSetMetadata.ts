import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { Account, Metadata } from "@/lib/zodTypes";

import { MetadataResponse, appMetadataQueryKey } from "./useAppMetadata";

const Params = z.object({
    metadata: Metadata,
    account: Account,
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
