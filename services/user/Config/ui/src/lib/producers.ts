import { z } from "zod";

import { zAccount } from "@/lib/zod/Account";

export const PubKeyPem = z
    .string()
    .regex(/-----BEGIN PUBLIC KEY-----[\s\S]*-----END PUBLIC KEY-----/, {
        message: "Invalid PEM key format",
    });

export const PubKeyAuthClaim = z.object({
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
    name: zAccount,
});

export const Modes = z.enum(["cft", "bft", "existing"]);

export const Params = z.object({
    prods: Producer.array().min(1, "At least one producer is required"),
    mode: Modes,
});

export type SetProducerParams = z.infer<typeof Params>;
type Producer = z.infer<typeof Producer>;
