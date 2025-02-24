import { Account } from "@/lib/zodTypes";
import { queryClient } from "@/queryClient";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { siteConfigQueryKey, SiteConfigResponse } from "./useSiteConfig";

const Params = z.object({
  account: Account,
  path: z.string(),
  csp: z.string(),
});

export const useSetCsp = () =>
  useMutation<null, Error, z.infer<typeof Params>>({
    mutationKey: ["setCsp"],
    mutationFn: async (par) => {
      const { account, path, csp } = Params.parse(par);
      const params = [account, path, csp];

      const args = {
        method: "setCsp",
        params,
        service: "workshop",
        intf: "app",
      };

      await supervisor.functionCall(args);

      return null;
    },
    onSuccess: (_, { account, path, csp }) => {
      toast.success(`Updated CSP for ${path} on ${account}`);

      queryClient.setQueryData(siteConfigQueryKey(account), (data: unknown) => {
        if (data) {
          const parsed = SiteConfigResponse.parse(data);
          
          const isGlobal = path === "*";

          if (isGlobal && parsed.getConfig) {
            parsed.getConfig.globalCsp = csp; 
          }
          
          return parsed;
        }
      });
    },
  });
