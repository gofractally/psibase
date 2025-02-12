import { Account } from "@/lib/zodTypes";
import { queryClient } from "@/queryClient";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AccountNameStatus } from "./useAccountStatus";

export const useCreateApp = () =>
  useMutation<void, Error, string>({
    mutationKey: ["selectAccount"],
    mutationFn: async (accountName: string) => {
      void (await supervisor.functionCall({
        method: "createApp",
        params: [Account.parse(accountName)],
        service: "workshop",
        intf: "registry",
      }));
    },
    onSuccess: (_, accountName) => {
      toast.success(`Created app ${accountName}`);
      queryClient.setQueryData(
        ["userAccount", accountName],
        () => AccountNameStatus.Enum.Taken
      );
    },
    onError: (error) => {
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error("Unrecognised error, please see log");
        console.error(error);
      }
    },
  });
