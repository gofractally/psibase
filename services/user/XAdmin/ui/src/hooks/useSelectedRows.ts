import { getId } from "@/lib/getId";
import { detectChange } from "@/lib/rowElements";
import { PackageInfo, PackageInfoSchema } from "../types";
import { RowSelectionState } from "@tanstack/react-table";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

interface ChangeWarning {
    removedPackage: PackageInfo;
    dependencies: PackageInfo[];
}

const ChangeWarningSchema = z.object({
    dependencies: PackageInfoSchema.array(),
    removedPackage: PackageInfoSchema,
});

const getChangeWarning = (
    removingPackagename: string,
    selectedPackages: PackageInfo[]
) => {
    const dependants = selectedPackages.filter((pack) =>
        pack.depends.map((x) => x.name).includes(removingPackagename)
    );

    if (dependants.length > 0) {
        return ChangeWarningSchema.parse({
            dependencies: dependants,
            removedPackage: selectedPackages.find(
                (pack) => pack.name == removingPackagename
            )!,
        });
    }
};

export const useSelectedRows = (
    allPackages: PackageInfo[],
    confirm: (warning: ChangeWarning) => Promise<boolean>
) => {
    const [outgoingRows, setOutgoingRows] = useState<RowSelectionState>({});
    const [incomingRows, setIncomingRows] = useState<RowSelectionState>({});
    const skipEffect = useRef(false);

    const check = async () => {
        const change = detectChange(outgoingRows, incomingRows);
        if (change) {
            const pack = allPackages.find((pack) => getId(pack) == change.name);
            if (!pack) throw new Error("Failed to find package");
            if (change.isAddition) {
                const newSelected = Object.keys(incomingRows);
                const dependenciesOfPackage = pack.depends.map(getId);
                const final = [...newSelected, ...dependenciesOfPackage]
                    .filter((item, index, arr) => arr.indexOf(item) == index)
                    .reduce<RowSelectionState>(
                        (acc, item) => ({ ...acc, [item]: true }),
                        {}
                    );
                setOutgoingRows(final);
                setIncomingRows(final);
            } else {
                const warning = getChangeWarning(
                    pack.name,
                    allPackages.filter((pack) =>
                        Object.keys(outgoingRows).some(
                            (id) => getId(pack) == id
                        )
                    )
                );
                if (warning) {
                    const shouldContinue = await confirm(warning);
                    if (shouldContinue) {
                        let updatedRows = incomingRows;
                        warning.dependencies.forEach(
                            (dependency) =>
                                delete updatedRows[getId(dependency)]
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
    };

    useEffect(() => {
        if (skipEffect.current) {
            skipEffect.current = false;    
        } else {
            check();
        }
    }, [incomingRows]);


    const overWriteRows = (rows: RowSelectionState) => {
        skipEffect.current = true;
        setOutgoingRows(rows);
        setIncomingRows(rows);
    }

    return [outgoingRows, setIncomingRows, overWriteRows] as const;
};
