import { z } from "zod";

export const MIN_ACCOUNT_NAME_LENGTH = 1;
export const MAX_ACCOUNT_NAME_LENGTH = 10;

export const zAccount = z
    .string()
    .min(MIN_ACCOUNT_NAME_LENGTH, {
        message: `Account must be at least ${MIN_ACCOUNT_NAME_LENGTH} characters.`,
    })
    .max(MAX_ACCOUNT_NAME_LENGTH, {
        message: `Account must be at most ${MAX_ACCOUNT_NAME_LENGTH} characters.`,
    })
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

export type Account = z.infer<typeof zAccount>;
