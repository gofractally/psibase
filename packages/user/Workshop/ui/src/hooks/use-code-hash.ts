import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { authorizedPluginGraphql } from "@shared/lib/graphql/authorized-plugin";
import { setcode } from "@shared/lib/plugins";
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
            const res = await authorizedPluginGraphql(
                setcode.authorized.graphql,
                `
        {
          code(account: "${account}") {
            codeHash
          }
        }
      `,
            );

            const parsed = ConfigResponse.parse(res);
            return parsed.code?.codeHash || null;
        },
    });
