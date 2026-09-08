import { ProcessedPackage } from "@/lib/zod/common-package";

import { transitivePkgDependants as walkPkgDependants } from "@shared/lib/transitive-pkg-dependants";

export function dependsOf(pack: ProcessedPackage): string[] {
    const meta =
        pack.status === "UpdateAvailable"
            ? pack.available
            : pack.status === "RollBackAvailable"
              ? pack.rollback
              : pack;
    return meta.depends.map((dep) => dep.name);
}

export function transitivePkgDependants(
    name: string,
    selected: string[],
    packages: ProcessedPackage[],
): string[] {
    const byName = new Map(packages.map((pack) => [pack.id, pack]));
    const items = selected.flatMap((id) => {
        const pack = byName.get(id);
        return pack ? [pack] : [];
    });
    return walkPkgDependants(name, items, (pack) => pack.id, dependsOf).map(
        (pack) => pack.id,
    );
}
