import { Account } from "@/lib/zodTypes";
import { queryClient } from "@/queryClient";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AccountNameStatus } from "./useAccountStatus";
import { z } from "zod";

const Params = z.object({
  account: Account,
  allowExistingAccount: z.boolean(),
});

export const useCreateApp = () =>
  useMutation<void, Error, z.infer<typeof Params>>({
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
      } catch (e) {
        const isExistingAccount =
          e instanceof Error && e.message.includes("account already exists");
        if (!isExistingAccount || !allowExistingAccount) throw e;
      }
    },
    onSuccess: (_, accountName) => {
      queryClient.setQueryData(
        ["userAccount", accountName],
        () => AccountNameStatus.Enum.Taken
      );
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
