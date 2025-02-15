import { Account } from "@/lib/zodTypes";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

const Params = z.object({
  account: Account,
  enableCache: z.boolean(),
});

export const useSetCacheMode = () =>
  useMutation<null, Error, z.infer<typeof Params>>({
    mutationKey: ["cacheMode"],
    mutationFn: async (params) => {
      const { account, enableCache } = Params.parse(params);

      await supervisor.functionCall({
        method: "setCacheMode",
        params: [account, enableCache],
        service: "workshop",
        intf: "app",
      });

      return null;
    },
    onSuccess: (_, { account, enableCache }) => {
      toast.success(
        `${enableCache ? "Enabled" : "Disabled"} cache on ${account}`
      );
    },
  });
