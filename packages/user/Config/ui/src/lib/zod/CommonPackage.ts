import { z } from "zod";

const DependencySchema = z.object({
    name: z.string(),
    version: z.string(),
});

export const PackageSchema = z.object({
    name: z.string(),
    version: z.string(),
    description: z.string(),
    depends: z.array(DependencySchema),
    accounts: z.array(z.string()),
});

export const UpToDate = PackageSchema.extend({
    status: z.literal("UpToDate"),
    id: z.string(),
});

export const InstalledButNotAvailable = PackageSchema.extend({
    status: z.literal("InstalledButNotAvailable"),
    id: z.string(),
});

export const Available = PackageSchema.extend({
    status: z.literal("Available"),
    id: z.string(),
});

export const UpdateAvailable = z.object({
    status: z.literal("UpdateAvailable"),
    id: z.string(),
    current: PackageSchema,
    available: PackageSchema,
});

export const RollbackAvailable = z.object({
    status: z.literal("RollBackAvailable"),
    id: z.string(),
    current: PackageSchema,
    rollback: PackageSchema,
});

export const zProcessedPackage = z.discriminatedUnion("status", [
    UpToDate,
    UpdateAvailable,
    Available,
    InstalledButNotAvailable,
    RollbackAvailable,
]);

export type ProcessedPackage = z.infer<typeof zProcessedPackage>;
