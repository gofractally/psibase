import z from "zod";

export const zU8 = z.number().int().min(0).max(255);
