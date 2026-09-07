import { useState } from "react";

import { transitivePkgDependants } from "@/lib/package-dependants";
import { ProcessedPackage } from "@/lib/zod/common-package";

import { toast } from "@shared/shadcn/ui/sonner";

import { resolveRequiredPackageNames } from "./use-install-packages";

const toSelectedIds = (names: string[]) =>
    Object.fromEntries(names.map((name) => [name, true]));

export const useSelectedPackages = (packages: ProcessedPackage[]) => {
    const [requested, setRequested] = useState<string[]>([]);
    const [selectedIds, setSelectedIds] = useState<{ [key: string]: boolean }>(
        {},
    );
    const [resolvingId, setResolvingId] = useState<string>();

    const selectedPackageNames = Object.entries(selectedIds)
        .filter((pack) => pack[1])
        .map(([name]) => name);

    const applyRequested = async (nextRequested: string[]) => {
        const unique = [...new Set(nextRequested)];
        if (unique.length === 0) {
            setRequested([]);
            setSelectedIds({});
            return;
        }
        const required = await resolveRequiredPackageNames(unique);
        setRequested(unique);
        setSelectedIds(toSelectedIds(required));
    };

    const onSelect = async (id: string) => {
        setResolvingId(id);
        try {
            if (selectedIds[id]) {
                const toDrop = new Set([
                    id,
                    ...transitivePkgDependants(id, requested, packages),
                ]);
                await applyRequested(requested.filter((name) => !toDrop.has(name)));
            } else {
                await applyRequested([...requested, id]);
            }
        } catch (error) {
            toast.error("Failed resolving dependencies", {
                description:
                    error instanceof Error ? error.message : String(error),
            });
        } finally {
            setResolvingId(undefined);
        }
    };

    const clear = () => {
        setRequested([]);
        setSelectedIds({});
    };

    return {
        selectedIds,
        selectedPackageNames,
        requestedPackageNames: requested,
        onSelect,
        clear,
        resolvingId,
    };
};
