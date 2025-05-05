import { Account } from "@/lib/zodTypes";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const Params = z.object({
  account: Account,
  publish: z.boolean(),
});

export const usePublishApp = () =>
  useMutation<null, Error, z.infer<typeof Params>>({
    mutationKey: ["publishApp"],
    mutationFn: async (params) => {
      const { account, publish } = Params.parse(params);

      await supervisor.functionCall({
        method: publish ? "publishApp" : "unpublishApp",
        params: [account],
        service: "workshop",
        intf: "registry",
      });

      return null;
    },
  });
