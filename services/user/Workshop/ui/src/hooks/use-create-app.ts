import { Account } from "@/lib/zodTypes";
import { queryClient } from "@/queryClient";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@shared/shadcn/ui/sonner";
import { AccountNameStatus } from "./useAccountStatus";
import { z } from "zod";
import { appMetadataQueryKey } from "./useAppMetadata";

const Params = z.object({
  account: Account,
  allowExistingAccount: z.boolean(),
});

const Result = z.enum(["Created", "Added"]);

export const useCreateApp = () =>
  useMutation<z.infer<typeof Result>, Error, z.infer<typeof Params>>({
    mutationKey: ["createApp"],
    mutationFn: async (params) => {
      const { account, allowExistingAccount } = Params.parse(params);
      try {
        void (await supervisor.functionCall({
          method: "createApp",
          params: [Account.parse(account)],
          service: "workshop",
          intf: "registry",
        }));
        return Result.Enum.Created;
      } catch (e) {
        const isExistingAccount =
          e instanceof Error && e.message.includes("account already exists");
        if (!isExistingAccount || !allowExistingAccount) throw e;
        return Result.Enum.Added;
      }
    },
    onSuccess: (result, { account }) => {
      queryClient.setQueryData(
        ["userAccount", account],
        () => AccountNameStatus.Enum.Taken
      );

      queryClient.setQueryData(appMetadataQueryKey(account), () => null);
        queryClient.invalidateQueries({
          queryKey: appMetadataQueryKey(account),
        });

      if (result === Result.Enum.Added) {
        toast.success(`Added app ${account}`);
      } else if (result == Result.Enum.Created) {
        toast.success(`Created app ${account}`);
      }
    },
    onError: (error) => {
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error("Unrecognized error, check the logs for details.");
        console.error(error);
      }
    },
  });
