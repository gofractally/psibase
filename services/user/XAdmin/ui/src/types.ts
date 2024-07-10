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

export type BootState =
    | undefined
    | [string, number, number]
    | string
    | TransactionTrace;

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
