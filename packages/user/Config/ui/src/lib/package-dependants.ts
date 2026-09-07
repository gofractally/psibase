import { ProcessedPackage } from "@/lib/zod/common-package";

export function dependsOf(pack: ProcessedPackage): string[] {
    const meta =
        pack.status === "UpdateAvailable"
            ? pack.available
            : pack.status === "RollBackAvailable"
              ? pack.rollback
              : pack;
    return meta.depends.map((dep) => dep.name);
}

export function transitiveDependants(
    name: string,
    selected: string[],
    packages: ProcessedPackage[],
): string[] {
    const byName = new Map(packages.map((pack) => [pack.id, pack]));
    const reverse = new Map<string, string[]>();
    for (const id of selected) {
        const pack = byName.get(id);
        if (!pack) {
            continue;
        }
        for (const dep of dependsOf(pack)) {
            const list = reverse.get(dep) ?? [];
            list.push(id);
            reverse.set(dep, list);
        }
    }

    const dependants = new Set<string>();
    const queue = [name];
    while (queue.length > 0) {
        const current = queue.shift()!;
        for (const dependant of reverse.get(current) ?? []) {
            if (dependant !== name && !dependants.has(dependant)) {
                dependants.add(dependant);
                queue.push(dependant);
            }
        }
    }
    return [...dependants];
}
