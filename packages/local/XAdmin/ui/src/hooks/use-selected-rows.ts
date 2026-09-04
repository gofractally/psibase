import { RowSelectionState } from "@tanstack/react-table";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { getId } from "@/lib/get-id";
import { getRequiredPackages } from "@/lib/get-required-packages";
import { detectChange } from "@/lib/row-elements";

import { PackageInfo, PackageInfoSchema } from "../types";

interface ChangeWarning {
    removedPackage: PackageInfo;
    dependencies: PackageInfo[];
}

const ChangeWarningSchema = z.object({
    dependencies: PackageInfoSchema.array(),
    removedPackage: PackageInfoSchema,
});

const getTransitiveDependants = (
    removingPackageName: string,
    selectedPackages: PackageInfo[],
): PackageInfo[] => {
    const reverseDeps = new Map<string, PackageInfo[]>();
    for (const pack of selectedPackages) {
        for (const dep of pack.depends) {
            const list = reverseDeps.get(dep.name) ?? [];
            list.push(pack);
            reverseDeps.set(dep.name, list);
        }
    }

    const dependants = new Map<string, PackageInfo>();
    const queue = [removingPackageName];

    while (queue.length > 0) {
        const current = queue.shift()!;
        for (const pack of reverseDeps.get(current) ?? []) {
            if (
                pack.name !== removingPackageName &&
                !dependants.has(pack.name)
            ) {
                dependants.set(pack.name, pack);
                queue.push(pack.name);
            }
        }
    }

    return [...dependants.values()];
};

const getChangeWarning = (
    removingPackagename: string,
    selectedPackages: PackageInfo[],
) => {
    const dependants = getTransitiveDependants(
        removingPackagename,
        selectedPackages,
    );

    if (dependants.length > 0) {
        return ChangeWarningSchema.parse({
            dependencies: dependants,
            removedPackage: selectedPackages.find(
                (pack) => pack.name == removingPackagename,
            )!,
        });
    }
};

export const useSelectedRows = (
    allPackages: PackageInfo[],
    confirm: (warning: ChangeWarning) => Promise<boolean>,
) => {
    const [outgoingRows, setOutgoingRows] = useState<RowSelectionState>({});
    const [incomingRows, setIncomingRows] = useState<RowSelectionState>({});
    const skipEffect = useRef(false);

    const check = useCallback(async () => {
        const change = detectChange(outgoingRows, incomingRows);
        if (change) {
            const pack = allPackages.find((pack) => getId(pack) == change.name);
            if (!pack) throw new Error("Failed to find package");
            if (change.isAddition) {
                const newSelected = Object.keys(incomingRows);
                const deps = getRequiredPackages(allPackages, [pack.name]).map(
                    getId,
                );

                const final = [...newSelected, ...deps]
                    .filter((item, index, arr) => arr.indexOf(item) == index)
                    .reduce<RowSelectionState>(
                        (acc, item) => ({ ...acc, [item]: true }),
                        {},
                    );
                setOutgoingRows(final);
                setIncomingRows(final);
            } else {
                const warning = getChangeWarning(
                    pack.name,
                    allPackages.filter((pack) =>
                        Object.keys(outgoingRows).some(
                            (id) => getId(pack) == id,
                        ),
                    ),
                );
                if (warning) {
                    const shouldContinue = await confirm(warning);
                    if (shouldContinue) {
                        const updatedRows = incomingRows;
                        warning.dependencies.forEach(
                            (dependency) =>
                                delete updatedRows[getId(dependency)],
                        );
                        setOutgoingRows(updatedRows);
                    } else {
                        setIncomingRows(outgoingRows);
                    }
                } else {
                    setOutgoingRows(incomingRows);
                }
            }
        } else {
            setOutgoingRows(incomingRows);
        }
    }, [allPackages, confirm, incomingRows, outgoingRows]);

    useEffect(() => {
        if (skipEffect.current) {
            skipEffect.current = false;
        } else {
            void check();
        }
    }, [check]);

    const overWriteRows = useCallback((rows: RowSelectionState) => {
        skipEffect.current = true;
        setOutgoingRows(rows);
        setIncomingRows(rows);
    }, []);

    return [outgoingRows, setIncomingRows, overWriteRows] as const;
};
