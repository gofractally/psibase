import { Account } from "@/lib/zodTypes";
import { queryClient } from "@/queryClient";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { siteConfigQueryKey, SiteConfigResponse } from "./useSiteConfig";
import { AwaitTime } from "@/lib/globals";

const u8Schema = z.number().int().min(0).max(255);

const File = z.object({
  path: z.string(),
  contentType: z.string(),
  content: z.any(),
});

const Params = z.object({
  account: Account,
  files: File.array(),
  compressionQuality: u8Schema,
});

export const useUploadTree = () =>
  useMutation<number, Error, z.infer<typeof Params>>({
    mutationKey: ["uploadTree"],
    mutationFn: async (params) => {
      const { account, compressionQuality, files } = Params.parse(params);

      const res = await supervisor.functionCall({
        method: "uploadTree",
        params: [account, files, compressionQuality],
        service: "workshop",
        intf: "app",
      });

      return z.number().parse(res);
    },
    onSuccess: (_, { account, files }) => {

      queryClient.setQueryData(siteConfigQueryKey(account), (data: unknown) => {
        if (data) {
          const parsed = SiteConfigResponse.parse(data);
          
          const updated: z.infer<typeof SiteConfigResponse> = {
            ...parsed,
            getContent: {
              ...parsed.getContent,
              edges: [
                ...parsed.getContent.edges,
                ...files.map(file => ({
                  node: {
                    path: file.path, 
                    contentType: file.contentType, 
                    account: account,
                    hash: '',
                    contentEncoding: '',
                    csp: ''
                  }
                }))
              ]
            }
          };

          return SiteConfigResponse.parse(updated);
        }
      })

      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: siteConfigQueryKey(account) });
      }, AwaitTime)
    
    },
  });
