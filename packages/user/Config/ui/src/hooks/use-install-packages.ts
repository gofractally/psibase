import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { supervisor } from "@/supervisor";
import { getArrayBuffer } from "@psibase/common-lib";

import { checkLastTx } from "@/lib/checkStaging";
import QueryKey from "@/lib/queryKeys";

import { toast } from "@shared/shadcn/ui/sonner";

import {
    PackageRepo,
    PackageSchemaWithSha,
    getPackageIndex,
} from "./use-available-packages";

type PackageOp = {
    old?: unknown;
    new?: PackageSchemaWithSha;
};

type PackageInstallOp = {
    old?: unknown;
    new?: ArrayBuffer;
};

async function installPackages(
    owner: string,
    packages: string[],
    request_pref: string,
    non_request_pref: string,
) {
    const index = flattenPackageIndex(await getPackageIndex(owner));
    const resolved = (await supervisor.functionCall({
        service: "packages",
        intf: "privateApi",
        method: "resolve",
        params: [index, packages, request_pref, non_request_pref],
    })) as PackageOp[];
    const ops = await loadPackages(resolved);
    const [data, install] = (await supervisor.functionCall({
        service: "packages",
        intf: "privateApi",
        method: "buildTransactions",
        params: [owner, ops, 4],
    })) as [ArrayBuffer[], ArrayBuffer[]];
    for (const tx of data) {
        await supervisor.functionCall({
            service: "packages",
            intf: "privateApi",
            method: "pushData",
            params: [tx],
        });
    }
    for (const tx of install) {
        await supervisor.functionCall({
            service: "packages",
            intf: "privateApi",
            method: "proposeInstall",
            params: [tx],
        });
    }
}

function flattenPackageIndex(index: PackageRepo[]) {
    return index.flatMap((repo) =>
        repo.index.map((info) => ({
            ...info,
            file: new URL(info.file, repo.baseUrl).toString(),
        })),
    );
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
            console.log(packages, "is the packages");
            if (packages.includes("Symbol")) {
                await installPackages(
                    "root",
                    packages.filter((x) => x !== "Symbol"),
                    "best",
                    "current",
                );
                await installPackages("root", ["Symbol"], "best", "current");
            } else {
                await installPackages("root", packages, "best", "current");
            }
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
