import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const AccountId = z.string();

const Params = z.object({
  account: AccountId,
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
  });
