import { z } from "zod";

/** Minimum length for network account names (empty names encode to 0). */
export const MIN_ACCOUNT_NAME_LENGTH = 1;
export const MIN_FREE_ACCOUNT_NAME_LENGTH = 8;
export const MAX_ACCOUNT_NAME_LENGTH = 10;

function accountNameSchema(minLength: number, minMessage: string) {
    return z
        .string()
        .min(minLength, { message: minMessage })
        .max(MAX_ACCOUNT_NAME_LENGTH, {
            message: `Account cannot be longer than ${MAX_ACCOUNT_NAME_LENGTH} characters.`,
        })
        .regex(/^[a-z0-9][a-z0-9-]*$/, {
            message:
                "Account must start with a letter or number and contain only lowercase letters, numbers, and hyphens.",
        })
        .refine((val) => !val.endsWith("-"), {
            message: "Account may not end with a hyphen.",
        })
        .refine((val) => !val.includes("--"), {
            message: "Account may not contain consecutive hyphens.",
        })
        .refine((val) => !val.startsWith("x-"), {
            message: "Account may not start with 'x-'.",
        });
}

export const zAccount = accountNameSchema(
    MIN_ACCOUNT_NAME_LENGTH,
    `Account must be at least ${MIN_ACCOUNT_NAME_LENGTH} characters.`,
);

export const zAccountFree = accountNameSchema(
    MIN_FREE_ACCOUNT_NAME_LENGTH,
    `Account must be at least ${MIN_FREE_ACCOUNT_NAME_LENGTH} characters.`,
);

export type Account = z.infer<typeof zAccount>;
export type AccountFree = z.infer<typeof zAccountFree>;
