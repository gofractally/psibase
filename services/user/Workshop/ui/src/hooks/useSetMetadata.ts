import { Account, Metadata } from "@/lib/zodTypes";
import { queryClient } from "@/queryClient";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { appMetadataQueryKey, MetadataResponse } from "./useAppMetadata";
import { AwaitTime } from "@/lib/globals";

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
            const oldData = MetadataResponse.parse(updater);
            return MetadataResponse.parse({
              appMetadata: metadata,
              extraMetadata: oldData.extraMetadata,
            });
          }
        }
      );
      setTimeout(() => {
        queryClient.refetchQueries({ queryKey: appMetadataQueryKey(account) });
      }, AwaitTime);
    },
  });
