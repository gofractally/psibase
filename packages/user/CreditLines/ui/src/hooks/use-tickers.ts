import { graphql } from "@/graphql";
import { zAccount } from "@/zod/Account";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const TickersSchema = z.object({
    tickers: z.object({
        nodes: z.array(
            z.object({
                ticker: zAccount,
                label: z.string(),
                precision: z.number(),
            }),
        ),
    }),
});

export const useTickers = () =>
    useQuery({
        queryKey: ["tickers"],
        queryFn: async () => {
            const res = await graphql(
                `
                    {
                        tickers(first: 99) {
                            nodes {
                                ticker
                                label
                                precision
                            }
                        }
                    }
                `,
                "credit-lines",
            );

            return TickersSchema.parse(res);
        },
    });
