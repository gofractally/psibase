import { getRequiredPackages } from "@/lib/get-required-packages";
import { PackageInfo } from "@/types";

export const bootTemplates = ["dev", "prod"] as const;

export type BootTemplate = (typeof bootTemplates)[number];

export const bootTemplateSystemPackage: Record<BootTemplate, string> = {
    dev: "DevDefault",
    prod: "ProdWithFG",
};

export const bootPackageNames = Object.values(bootTemplateSystemPackage);

export const bootTemplatesAvailable = (packages: PackageInfo[]): boolean =>
    bootPackageNames.every((name) => packages.some((pack) => pack.name === name));

export const getDefaultSelectedPackages = (
    template: BootTemplate,
    packages: PackageInfo[],
): PackageInfo[] => {
    if (packages.length == 0) return [];

    const relevantPackageName = bootTemplateSystemPackage[template];
    const relevantPackage = packages.find(
        (pack) => pack.name === relevantPackageName,
    );
    if (!relevantPackage)
        throw new Error(
            `Failed to find relevant package for ${relevantPackageName}`,
        );

    return getRequiredPackages(packages, [relevantPackageName]);
};
