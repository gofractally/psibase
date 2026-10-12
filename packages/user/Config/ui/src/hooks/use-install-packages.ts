import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { checkLastTx } from "@/lib/check-staging";
import QueryKey from "@/lib/query-keys";

import { callPluginFunction, config } from "@shared/lib/plugins";
import { queryClient } from "@shared/lib/query-client";
import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

import { zPackageSchemaWithSha } from "./use-available-packages";

const zPackageOp = z.object({
    old: z.unknown().optional(),
    new: zPackageSchemaWithSha.nullish(),
});

type PackagePreference = "best" | "compatible" | "current";

async function resolvePackageOps(
    owner: string,
    packages: string[],
    requestPref: PackagePreference,
    nonRequestPref: PackagePreference,
) {
    const index = zPackageSchemaWithSha.array().parse(
        await callPluginFunction(config.packaging.getAvailablePackages, [
            owner,
        ]),
    );
    return zPackageOp.array().parse(
        await supervisor.functionCall({
            service: "packages",
            intf: "privateApi",
            method: "resolve",
            params: [index, packages, requestPref, nonRequestPref],
        }),
    );
}

async function installPackages(
    owner: string,
    packages: string[],
    requestPref: PackagePreference,
    nonRequestPref: PackagePreference,
) {
    await callPluginFunction(config.packaging.installPackages, [
        owner,
        packages,
        requestPref,
        nonRequestPref,
    ]);
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
