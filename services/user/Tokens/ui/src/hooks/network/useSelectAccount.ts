import { queryClient, supervisor } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

export const useSelectAccount = () =>
  useMutation<void, Error, string>({
    mutationKey: ["selectAccount"],
    mutationFn: async (accountName: string) => {
      void (await supervisor.functionCall({
        method: "login",
        params: [z.string().parse(accountName)],
        service: "accounts",
        intf: "activeApp",
      }));
    },
    onSuccess: (_, account) => {
      queryClient.refetchQueries({ queryKey: ["loggedInUser"] });
      setTimeout(() => {
        queryClient.refetchQueries({ queryKey: ["loggedInUser"] });
      }, 2000);
      toast.success(`Logged in as ${account}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
