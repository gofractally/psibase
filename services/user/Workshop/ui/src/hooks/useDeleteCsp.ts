import { Account } from "@/lib/zodTypes";
import { queryClient } from "@/queryClient";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { siteConfigQueryKey, SiteConfigResponse } from "./useSiteConfig";
import { AwaitTime } from "@/lib/globals";

const Params = z.object({
  account: Account,
  path: z.string(),
});

export const useDeleteCsp = () =>
  useMutation<null, Error, z.infer<typeof Params>>({
    mutationKey: ["deleteCsp"],
    mutationFn: async (par) => {
      const { account, path } = Params.parse(par);
      const params = [account, path];

      const args = {
        method: "deleteCsp",
        params,
        service: "workshop",
        intf: "app",
      };

      await supervisor.functionCall(args);

      return null;
    },
    onSuccess: (_, { account, path }) => {
      toast.success(`Deleted CSP for ${path} on ${account}`);

      queryClient.setQueryData(siteConfigQueryKey(account), (data: unknown) => {
        if (data) {
          const parsed = SiteConfigResponse.parse(data);
          
          const isGlobal = path === "*";

          if (isGlobal) {
            return SiteConfigResponse.parse({
              ...parsed,
              getConfig: {
                ...parsed.getConfig,
                globalCsp: '',
              },
            });
          } else {
            return SiteConfigResponse.parse({
              ...parsed,
              getContent: {
                ...parsed.getContent,
                edges: parsed.getContent.edges.map(edge => edge.node.path == path ? {
                  ...edge,
                  node: {
                    ...edge.node,
                    csp: '',
                  },
                } : edge)
              }
            });
          }
        }
      });

      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: siteConfigQueryKey(account) });
      }, AwaitTime)
    },
  });
