import { getRequiredPackages } from "@/lib/get-required-packages";
import { PackageInfo } from "@/types";

export const bootTemplates = ["dev", "prod", "priv"] as const;

export type BootTemplate = (typeof bootTemplates)[number];

const bootPackageName: Record<BootTemplate, string> = {
    dev: "DevDefault",
    prod: "ProdWithFG",
    priv: "PrivDefault",
};

export const getDefaultSelectedPackages = (
    template: BootTemplate | undefined,
    packages: PackageInfo[],
): PackageInfo[] => {
    if (!template || packages.length == 0) return [];

    const relevantPackageName = bootPackageName[template];
    const relevantPackage = packages.find(
        (pack) => pack.name === relevantPackageName,
    );
    if (!relevantPackage)
        throw new Error(
            `Failed to find relevant package for ${relevantPackageName}`,
        );

    return getRequiredPackages(packages, [relevantPackageName]);
};
