import { PackageInfo } from "@/types";
import { isLeftLessThanRight, splitVersion } from "./splitVersion";

export const filterHighestVersions = (
    packages: PackageInfo[]
): PackageInfo[] => {
    const byNameDictionary = new Map();
    for (const info of packages) {
        const version = splitVersion(info.version);
        if (version) {
            const existingPackage = byNameDictionary.get(info.name);
            if (
                !existingPackage ||
                isLeftLessThanRight(
                    splitVersion(existingPackage.version),
                    version
                )
            ) {
                byNameDictionary.set(info.name, info);
            }
        }
    }

    return [...byNameDictionary.values()];
};
