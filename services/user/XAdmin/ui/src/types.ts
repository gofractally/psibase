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
