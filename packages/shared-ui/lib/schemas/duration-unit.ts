import { z } from "zod";

export const zDurationUnit = z.enum(["Minutes", "Hours", "Days"]);

export type DurationUnit = z.infer<typeof zDurationUnit>;
