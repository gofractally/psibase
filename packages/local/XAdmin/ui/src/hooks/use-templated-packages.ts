import { getRequiredPackages } from "@/lib/get-required-packages";
import { PackageInfo } from "@/types";

export const bootTemplates = ["dev", "prod", "priv"] as const;

export type BootTemplate = (typeof bootTemplates)[number];

export const bootTemplateConfig: Record<
    BootTemplate,
    { systemPackage: string; nodeLocal?: string }
> = {
    dev: { systemPackage: "DevDefault" },
    prod: { systemPackage: "ProdWithFG" },
    priv: { systemPackage: "PrivDefault", nodeLocal: "XPrivDefault" },
};

export const bootPackageNames = Object.values(bootTemplateConfig).map(
    (entry) => entry.systemPackage,
);

export const bootTemplatesAvailable = (packages: PackageInfo[]): boolean =>
    bootPackageNames.every((name) => packages.some((pack) => pack.name === name));

export const nodeLocalPackageForTemplate = (
    template: BootTemplate,
): string | undefined => bootTemplateConfig[template].nodeLocal;

export const getDefaultSelectedPackages = (
    template: BootTemplate,
    packages: PackageInfo[],
): PackageInfo[] => {
    if (packages.length == 0) return [];

    const relevantPackageName = bootTemplateConfig[template].systemPackage;
    const relevantPackage = packages.find(
        (pack) => pack.name === relevantPackageName,
    );
    if (!relevantPackage)
        throw new Error(
            `Failed to find relevant package for ${relevantPackageName}`,
        );

    return getRequiredPackages(packages, [relevantPackageName]);
};
