import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

import { Account } from "@/lib/zodTypes";

export const PubKeyPem = z
    .string()
    .regex(/-----BEGIN PUBLIC KEY-----[\s\S]*-----END PUBLIC KEY-----/, {
        message: "Invalid PEM key format",
    });

const PubKeyAuthClaim = z.object({
    tag: z.literal("pubkey-pem"),
    val: PubKeyPem,
});

// const GenericAuthClaim = z.object({
//     tag: z.literal("generic"),
//     val: z.object({
//         verifyService: z.string(),
//         rawData: z.record(z.number()),
//     }),
// });

const AuthClaim = z.discriminatedUnion("tag", [
    PubKeyAuthClaim,
    // GenericAuthClaim,
]);

const Producer = z.object({
    authClaim: AuthClaim,
    name: Account,
});

export const Modes = z.enum(["cft", "bft", "existing"]);

export const Params = z.object({
    prods: Producer.array().min(1, "At least one producer is required"),
    mode: Modes,
});

export type SetProducerParams = z.infer<typeof Params>;
type Producer = z.infer<typeof Producer>;

export const useSetProducers = () =>
    useMutation({
        mutationFn: async (params: SetProducerParams) => {
            const parsedParams = Params.parse(params);

            void (await supervisor.functionCall({
                service: "producers",
                method:
                    params.mode === "existing"
                        ? "setProducers"
                        : params.mode === "cft"
                          ? "setCftConsensus"
                          : "setBftConsensus",
                params: [parsedParams.prods],
                intf: "api",
            }));
        },
    });
