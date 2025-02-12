import { Account } from "@/lib/zodTypes";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

const Params = z.object({
  account: Account,
  enableSpa: z.boolean(),
});

export const useSpa = () =>
  useMutation<null, Error, z.infer<typeof Params>>({
    mutationKey: ["spa"],
    mutationFn: async (params) => {
      const { account, enableSpa } = Params.parse(params);

      await supervisor.functionCall({
        method: "enableSpa",
        params: [account, enableSpa],
        service: "workshop",
        intf: "app",
      });

      return null;
    },
    onSuccess: (_, { account, enableSpa }) => {
      toast.success(`${enableSpa ? "Enabled" : "Disabled"} SPA on ${account}`);
    },
  });
