import { z } from "zod";

const zPackageDependency = z.object({
    name: z.string(),
    version: z.string(),
});

export const zInstalledPackageMeta = z.object({
    name: z.string(),
    version: z.string(),
    scope: z.string(),
    description: z.string(),
    depends: z.array(zPackageDependency),
    accounts: z.array(z.string()),
    services: z.array(z.string()),
});

export type InstalledPackageMeta = z.infer<typeof zInstalledPackageMeta>;
