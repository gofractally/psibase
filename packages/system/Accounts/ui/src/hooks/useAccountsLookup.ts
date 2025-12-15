import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { graphql } from "@/lib/graphql";

import { AuthServices } from "../types";

export const useAccountsLookup = (publicKey: string | undefined | null) =>
    useQuery({
        queryKey: ["accounts", publicKey],
        queryFn: async () => {
            const res = await graphql(
                `
        {
          accWithKey(
            pubkeyPem: "${publicKey}"
          ) {
            edges {
              node {
                account
              }
            }
          }
        }
      `,
                AuthServices.AUTH_SIG,
            );

            return z
                .object({
                    accWithKey: z.object({
                        edges: z.array(
                            z.object({
                                node: z.object({
                                    account: z.string(),
                                }),
                            }),
                        ),
                    }),
                })
                .parse(res)
                .accWithKey.edges.map((x) => x.node.account);
        },
        initialData: [],
        enabled: !!publicKey,
    });
