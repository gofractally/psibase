import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { supervisor } from "@/supervisor";

export const Account = z
    .string()
    .min(1, { message: "Account must be at least 1 character." })
    .max(18, { message: "Account must be at most 18 characters." })
    .regex(/^[a-z][a-z0-9-]*$/, {
        message:
            "Account must start with a letter and contain only lowercase letters, numbers, and hyphens.",
    })
    .refine((val) => !val.endsWith("-"), {
        message: "Account may not end with a hyphen.",
    })
    .refine((val) => !val.startsWith("-"), {
        message: "Account may not start with a hyphen.",
    })
    .refine((val) => !val.startsWith("x-"), {
        message: "Account may not start with 'x-'.",
    });

export const PubKeyPem = z
    .string()
    .regex(/-----BEGIN PUBLIC KEY-----[\s\S]*-----END PUBLIC KEY-----/, {
        message: "Invalid PEM key format",
    });

const PubKeyAuthClaim = z.object({
    tag: z.literal("pubkey-pem"),
    val: PubKeyPem,
});

const GenericAuthClaim = z.object({
    tag: z.literal("generic"),
    val: z.object({
        verifyService: z.string(),
        rawData: z.record(z.number()),
    }),
});

const AuthClaim = z.discriminatedUnion("tag", [
    PubKeyAuthClaim,
    GenericAuthClaim,
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

type Params = z.infer<typeof Params>;
type Producer = z.infer<typeof Producer>;

export const useSetProducers = () =>
    useMutation({
        mutationFn: async (params: Params) => {
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
