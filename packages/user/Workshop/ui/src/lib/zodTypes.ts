import { z } from "zod";

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

export const Metadata = z.object({
    name: z.string().max(30),
    shortDesc: z.string().max(100),
    longDesc: z.string().max(1000),
    icon: z.string(), // Base64 string
    iconMimeType: z.string(), // MIME type of the icon
    tosSubpage: z
        .string()
        .refine((val) => val.startsWith("/"), { message: "Must start with /" }),
    privacyPolicySubpage: z
        .string()
        .refine((val) => val.startsWith("/"), { message: "Must start with /" }),
    appHomepageSubpage: z
        .string()
        .refine((val) => val.startsWith("/"), { message: "Must start with /" }),
    redirectUris: z.string().array(),
    tags: z.string().array().max(3),
});

export const Path = z.string().transform((path) => {
    const normalizedPath = path.replace(/\/+/g, "/");
    const cleanPath = normalizedPath.startsWith("/")
        ? normalizedPath.slice(1)
        : normalizedPath;
    const trimmedPath = cleanPath.endsWith("/")
        ? cleanPath.slice(0, -1)
        : cleanPath;
    return "/" + trimmedPath;
});
