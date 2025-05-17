import { z } from "zod";

export const zDateTime = z.string().datetime({ offset: true });

export type DateTime = z.infer<typeof zDateTime>;