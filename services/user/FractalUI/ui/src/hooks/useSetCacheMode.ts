import { Account } from "@/lib/zodTypes";
import { queryClient } from "@/queryClient";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { siteConfigQueryKey, SiteConfigResponse } from "./useSiteConfig";

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

      queryClient.setQueryData(siteConfigQueryKey(account), (data: unknown) => {
        if (data) {
          const parsed = SiteConfigResponse.parse(data);
          const newData: z.infer<typeof SiteConfigResponse> = {
            ...parsed,
            getConfig: parsed.getConfig && {
              ...parsed.getConfig,
              cache: enableCache,
            },
          };
          return SiteConfigResponse.parse(newData);
        }
      });
    },
  });
