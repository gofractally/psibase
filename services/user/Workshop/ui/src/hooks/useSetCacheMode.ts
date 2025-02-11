import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const AccountId = z.string();

const Params = z.object({
  account: AccountId,
  enableCache: z.boolean(),
});

export const useSpa = () =>
  useMutation<null, Error, z.infer<typeof Params>>({
    mutationKey: ["spa"],
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
  });
