import { z } from "zod";

export interface PackageRef {
    name: string;
    version: string;
}

export interface PackageMeta {
    name: string;
    version: string;
    description: string;
    depends: PackageRef[];
    accounts: string[];
}

export interface PackageInfo extends PackageMeta {
    file: string;
    sha256: string;
}

export type ServicesType = {
    [key: string]: boolean;
};

export interface ProducerType {
    producer: string;
}

export type RequestUpdate = [
    type: string,
    completed: number,
    started: number,
    labels: string[]
];

export const RequestUpdateSchema = z.tuple([
    z.string(),
    z.number(),
    z.number(),
    z.string().array(),
]);

export const BootCompleteSchema = z.object({
    type: z.literal("BootComplete"),
    success: z.boolean(),
});

export type BootCompleteUpdate = z.infer<typeof BootCompleteSchema>;

export type BootState =
    | undefined
    | RequestUpdate
    | string
    | TransactionTrace
    | BootCompleteUpdate;

export type InstallType = {
    installType: string;
};

const DependencySchema = z.object({
    name: z.string(),
    version: z.string(),
});

export const PackageInfoSchema = z.object({
    accounts: z.string().array(),
    depends: z.array(DependencySchema),
    description: z.string(),
    file: z.string(),
    name: z.string(),
    sha256: z.string(),
    version: z.string(),
});

export const WrappedPackages = z
    .object({
        Install: PackageInfoSchema,
    })
    .array();

export type PackageInfoShape = z.infer<typeof PackageInfoSchema>;

export const KeyDeviceSchema = z.object({
    id: z.string().min(1),
    pin: z.string().optional(),
});
