import { Account } from "@/lib/zodTypes";
import { queryClient } from "@/queryClient";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { codeHashQueryKey } from "./useCodeHash";
import { AwaitTime } from "@/lib/globals";

const Params = z.object({
  account: Account,
  code: z.any(),
});

export const useSetServiceCode = () =>
  useMutation<null, Error, z.infer<typeof Params>>({
    mutationKey: ["setServiceCode"],
    mutationFn: async (params) => {
      const { account, code } = Params.parse(params);

      const args = {
        method: "setServiceCode",
        params: [account, code],
        service: "workshop",
        intf: "app",
      };

      const res = await supervisor.functionCall(args);
      console.log(res, "came back on service code!!!");

      return null;
    },
    onSuccess: (_, params) => {
      toast("Success", {
        description: `Uploaded service to ${params.account}`,
      });

      setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: codeHashQueryKey(params.account),
        });
      }, AwaitTime);
    },
    onError: (error) => {
      if (error instanceof Error) {
        toast("Error", {
          description: `Failed uploading service ${error.message}`,
        });
      } else {
        console.error(error);
        toast("Error", {
          description: `Failed uploading service, see log for details`,
        });
      }
    },
  });
