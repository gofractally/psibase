import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { getArrayBuffer } from "@psibase/common-lib";

import { checkLastTx } from "@/lib/check-staging";
import QueryKey from "@/lib/query-keys";

import { callPluginFunction, config } from "@shared/lib/plugins";
import type {
    PackageInstallOp,
    PackagePreference,
} from "@shared/lib/plugins/config";
import { queryClient } from "@shared/lib/query-client";
import { toast } from "@shared/shadcn/ui/sonner";

import {
    PackageRepo,
    getPackageIndex,
    zPackageSchemaWithSha,
} from "./use-available-packages";

const zPackageOp = z.object({
    old: z.unknown().optional(),
    new: zPackageSchemaWithSha.nullish(),
});

type PackageOp = z.infer<typeof zPackageOp>;

async function resolvePackageOps(
    owner: string,
    packages: string[],
    requestPref: PackagePreference,
    nonRequestPref: PackagePreference,
): Promise<PackageOp[]> {
    const index = flattenPackageIndex(await getPackageIndex(owner));
    return zPackageOp.array().parse(
        await callPluginFunction(config.packaging.resolvePackages, [
            index,
            packages,
            requestPref,
            nonRequestPref,
        ]),
    );
}

async function installPackages(
    owner: string,
    packages: string[],
    requestPref: PackagePreference,
    nonRequestPref: PackagePreference,
) {
    const resolved = await resolvePackageOps(
        owner,
        packages,
        requestPref,
        nonRequestPref,
    );
    const ops = await loadPackages(resolved);
    await callPluginFunction(config.packaging.installPackages, [owner, ops]);
}

function flattenPackageIndex(index: PackageRepo[]) {
    return index.flatMap((repo) =>
        repo.index.map((info) => ({
            ...info,
            file: new URL(info.file, repo.baseUrl).toString(),
        })),
    );
}

export async function resolveRequiredPackageNames(
    packages: string[],
): Promise<string[]> {
    const resolved = await resolvePackageOps(
        "root",
        packages,
        "best",
        "current",
    );
    return [...new Set(resolved.flatMap((op) => (op.new ? [op.new.name] : [])))];
}

async function loadPackages(ops: PackageOp[]): Promise<PackageInstallOp[]> {
    return await Promise.all(
        ops.map(async (op) => {
            if (op.new) {
                return { old: op.old, new: await getArrayBuffer(op.new.file) };
            } else {
                return { old: op.old };
            }
        }),
    );
}

export const useInstallPackages = () => {
    const navigate = useNavigate();

    return useMutation<void, Error, string[], string | number>({
        onMutate: () => {
            return toast.loading("Loading...");
        },
        mutationFn: async (packages) => {
            await installPackages("root", packages, "best", "current");
        },
        onError: (errorObj, _, id) => {
            toast.error("Failed installing", {
                description: errorObj.message,
                id,
            });
        },
        onSuccess: async (_, __, id) => {
            const lastTx = await checkLastTx();

            queryClient.invalidateQueries({
                queryKey: QueryKey.availablePackages(),
            });
            queryClient.invalidateQueries({
                queryKey: QueryKey.installedPackages(),
            });
            if (lastTx.type == "executed") {
                toast.success("Installed package", {
                    id,
                    description: "Change is live.",
                });
            } else {
                toast.success("Proposed package installation", {
                    id,
                    description: "Awaiting approval.",
                    action: {
                        label: "View",
                        onClick: () => {
                            navigate(
                                `/pending-transactions/${lastTx.stagedId}`,
                            );
                        },
                    },
                });
            }
        },
    });
};
