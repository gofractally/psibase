import { z } from "zod";

import { zAccount } from "@shared/lib/schemas/account";

export const Modes = z.enum(["cft", "bft", "existing"]);

export const Params = z.object({
    prods: z.array(zAccount).min(1, "At least one producer is required"),
    mode: Modes,
});

export type SetProducerParams = z.infer<typeof Params>;
