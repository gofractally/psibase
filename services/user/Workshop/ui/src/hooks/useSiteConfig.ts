import { graphql } from "@/lib/graphql";
import { Account } from "@/lib/zodTypes";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { siblingUrl } from "../../../../CommonApi/common/packages/common-lib/src";

const CSPString = z.string();

const Config = z.object({
  account: Account,
  spa: z.boolean(),
  cache: z.boolean(),
  globalCsp: CSPString,
});

export const siteConfigQueryKey = (
  account: z.infer<typeof Account> | undefined | null
) => ["siteConfig", account];

export const SiteConfigResponse = z.object({
  getConfig: Config.or(z.null()),
  getContent: z.object({
    edges: z
      .object({
        node: z.object({
          account: Account,
          path: z.string(),
          contentType: z.string(),
          hash: z.string(),
          contentEncoding: z.string().or(z.null()),
          csp: CSPString,
        }),
      })
      .array(),
  }),
});

export const useSiteConfig = (
  account: z.infer<typeof Account> | undefined | null
) =>
  useQuery({
    queryKey: siteConfigQueryKey(account),
    enabled: !!account,
    queryFn: async () => {
      console.log("this is running");
      try {
        const res = await graphql(
          `
          {
          getConfig(account: "${account}") {
            account
            spa
            cache
            globalCsp
          }
          getContent(account: "${account}", first: 99) {
            edges {
              node {
                account
                path
                contentType
                hash
                contentEncoding
                csp
              }
            }
            pageInfo {
              hasPreviousPage
              hasNextPage
              startCursor
              endCursor
              }
              }
              }
              `,
          siblingUrl(null, "sites", "graphql")
        );

        console.log(res, "raw graphql");
        return SiteConfigResponse.parse(res);
      } catch (e) {
        toast("failure");
        console.error(e, "sss");
      }
    },
  });
