import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@shared/lib/graphql";
import { zAccount } from "@shared/lib/schemas/account";

export const ConfigResponse = z.object({
    code: z
        .object({
            codeHash: z.string(),
        })
        .or(z.null()),
});

export const codeHashQueryKey = (
    account: z.infer<typeof zAccount> | undefined | null,
) => ["code", account];

export const useCodeHash = (
    account: z.infer<typeof zAccount> | undefined | null,
) =>
    useQuery({
        queryKey: codeHashQueryKey(account),
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
                { service: "setcode" },
            );

            const parsed = ConfigResponse.parse(res);
            return parsed.code?.codeHash || null;
        },
    });
