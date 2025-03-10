import { z } from "zod";

export const Amount = z
  .string()
  .refine((amount) => amount.length > 0)
  .refine(
    (amountStr) =>
      amountStr.split("").every((char) => !Number.isNaN(Number(char))),
    { message: "Invalid number" }
  );

