import { supervisor } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const AccountId = z.string();

const Params = z.object({
  account: AccountId,
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
        service: "registry",
        intf: "developer",
      });

      return null;
    },
  });
