import { z } from "zod";

/** Minimum length for network account names (empty names encode to 0). */
export const MIN_ACCOUNT_NAME_LENGTH = 1;
export const MIN_FREE_ACCOUNT_NAME_LENGTH = 8;
export const MAX_ACCOUNT_NAME_LENGTH = 10;
export const MAX_SUBACCOUNT = 255;

function baseNameSchema(minLength: number, minMessage: string) {
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
        });
}

function accountNameSchema(minLength: number, minMessage: string) {
    return baseNameSchema(minLength, minMessage).refine(
        (val) => !val.startsWith("x-"),
        { message: "Account may not start with 'x-'." },
    );
}

export const zAccount = accountNameSchema(
    MIN_ACCOUNT_NAME_LENGTH,
    `Account must be at least ${MIN_ACCOUNT_NAME_LENGTH} characters.`,
);

export const zAccountFree = accountNameSchema(
    MIN_FREE_ACCOUNT_NAME_LENGTH,
    `Account must be at least ${MIN_FREE_ACCOUNT_NAME_LENGTH} characters.`,
);

/** Node-local app account (`x-…`), e.g. a resource-provider payment portal. */
export const zLocalAccount = baseNameSchema(
    MIN_ACCOUNT_NAME_LENGTH,
    `Account must be at least ${MIN_ACCOUNT_NAME_LENGTH} characters.`,
).refine((val) => val.startsWith("x-"), {
    message: "Account must start with 'x-'.",
});

const zBaseAccountNumber = baseNameSchema(
    MIN_ACCOUNT_NAME_LENGTH,
    `Account must be at least ${MIN_ACCOUNT_NAME_LENGTH} characters.`,
);

const zSubaccount = z
    .string()
    .regex(/^[1-9]\d{0,2}$/, {
        message: `Subaccount must be a number from 1 to ${MAX_SUBACCOUNT}.`,
    })
    .refine((val) => Number(val) <= MAX_SUBACCOUNT, {
        message: `Subaccount must be a number from 1 to ${MAX_SUBACCOUNT}.`,
    });

/**
 * Any name that can exist on chain, in canonical `base` or `base+N` form.
 * Unlike `zAccount`, this accepts reserved `x-` names, so use it for lookups
 * rather than for names a user is about to create.
 */
export const zAccountNumber = z.string().superRefine((val, ctx) => {
    const sep = val.indexOf("+");
    const base = sep === -1 ? val : val.slice(0, sep);
    const sub = sep === -1 ? undefined : val.slice(sep + 1);

    const issues = [
        ...(zBaseAccountNumber.safeParse(base).error?.issues ?? []),
        ...(sub === undefined
            ? []
            : (zSubaccount.safeParse(sub).error?.issues ?? [])),
    ];
    for (const issue of issues) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue.message });
    }
});

export type Account = z.infer<typeof zAccount>;
export type AccountFree = z.infer<typeof zAccountFree>;
export type LocalAccount = z.infer<typeof zLocalAccount>;
export type AccountNumber = z.infer<typeof zAccountNumber>;
