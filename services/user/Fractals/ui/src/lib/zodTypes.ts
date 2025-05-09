import { z } from "zod";

export const zAccount = z
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

export type Account = z.infer<typeof zAccount>;


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
