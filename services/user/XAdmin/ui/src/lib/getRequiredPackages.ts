import { PackageInfo, WrappedPackages } from "../types";
import { packages as packageInterface } from "wasm-transpiled";

export const getRequiredPackages = (
    packages: PackageInfo[],
    packageNames: string[]
): PackageInfo[] =>
    WrappedPackages.parse(
        JSON.parse(
            packageInterface.resolvePackages(
                JSON.stringify(packages),
                packageNames
            )
        )
    ).map((x) => x.Install);
