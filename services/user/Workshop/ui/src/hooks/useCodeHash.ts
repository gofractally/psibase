import { graphql } from "@/lib/graphql";
import { Account } from "@/lib/zodTypes";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { siblingUrl } from "../../../../CommonApi/common/packages/common-lib/src";

export const ConfigResponse = z.object({
  code: z
    .object({
      codeHash: z.string(),
    })
    .or(z.null()),
});

export const useCodeHash = (
  account: z.infer<typeof Account> | undefined | null
) =>
  useQuery({
    queryKey: ["code", account],
    enabled: !!account,
    queryFn: async () => {
      const res = await graphql(
        `
        {
          code(account: "${account}") {
            codeHash
          }
        }
      `,
        siblingUrl(null, "setcode", "graphql")
      );

      const parsed = ConfigResponse.parse(res);
      return parsed.code?.codeHash || null;
    },
  });
