import { PackageInfo, WrappedPackages } from "../types";
import * as wasm from "wasm-psibase";

export const getRequiredPackages = (
    packages: PackageInfo[],
    packageNames: string[]
): PackageInfo[] =>
    WrappedPackages.parse(
        wasm.js_resolve_packages(packages, packageNames, [])
    ).map((x) => x.Install);
