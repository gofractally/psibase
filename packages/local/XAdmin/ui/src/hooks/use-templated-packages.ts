import { getRequiredPackages } from "@/lib/get-required-packages";
import { PackageInfo } from "@/types";

interface InstallationOptions {
    dev: boolean;
}

export const getDefaultSelectedPackages = (
    options: InstallationOptions,
    packages: PackageInfo[],
): PackageInfo[] => {
    const { dev } = options;
    if (packages.length == 0) return [];

    const relevantPackageName = dev ? "DevDefault" : "ProdWithFG";
    const relevantPackage = packages.find(
        (pack) => pack.name === relevantPackageName,
    );
    if (!relevantPackage)
        throw new Error(
            `Failed to find relevant package for ${relevantPackageName}`,
        );

    return getRequiredPackages(packages, [relevantPackageName]);
};
