import { PackageInfo } from "@/types";
import partition from "lodash.partition";

const knownNames = [
    "Accounts",
    "AuthAny",
    "AuthDelegate",
    "AuthK1",
    "AuthSig",
    "CommonApi",
    "CpuLimit",
    "Default",
    "Docs",
    "Events",
    "Explorer",
    "Fractal",
    "HttpServer",
    "Invite",
    "Minimal",
    "Nft",
    "Nop",
    "Packages",
    "Producers",
    "SetCode",
    "Sites",
    "Supervisor",
    "Symbol",
    "TokenUsers",
    "Tokens",
    "Transact",
];

interface InstallationOptions {
    dev: boolean;
}

export const getDefaultSelectedPackages = (
    options: InstallationOptions,
    packages: PackageInfo[]
): {
    selectedPackages: PackageInfo[];
    unknownPackages: PackageInfo[];
} => {
    const { dev } = options;

    const [knownPackages, unknownPackages] = partition(packages, (pack) =>
        knownNames.includes(pack.name)
    );

    const selectedNames = dev
        ? knownNames
        : knownNames
              .filter((name) => name !== "Nop")
              .filter((name) => name !== "TokenUsers");

    return {
        selectedPackages: knownPackages.filter((pack) =>
            selectedNames.includes(pack.name)
        ),
        unknownPackages,
    };
};
