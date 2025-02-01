import { graphql } from "@/lib/graphql";
import { useQuery } from "@tanstack/react-query";

import { z } from "zod";

export const useAccountLookup = (accountName: string | undefined | null) =>
  useQuery({
    queryKey: ["account", accountName],
    queryFn: async () => {
      const res = await graphql(`{
            account(name: "${accountName}") {
                pubkey
                account
          }
        }`);

      return z
        .object({
          account: z.object({
            account: z.string(),
            pubkey: z.string(),
          }),
        })
        .parse(res).account;
    },
    enabled: !!accountName,
  });
