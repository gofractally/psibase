import { useState } from "react";
import { useForm } from "react-hook-form";
import { getJson } from "@psibase/common-lib";
import * as wasm from "wasm-psibase";
import { useConfig } from "../hooks/useConfig";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
    BootState,
    InstallType,
    PackageInfo,
    PackageMeta,
    ProducerType,
    ServicesType,
    WrappedPackages,
} from "../types";
import { ServicesForm } from "@/components/forms/services-form";
import { InstallForm } from "@/components/forms/install-form";
import { TypeForm } from "@/components/forms/type-form";
import { ProducerForm } from "@/components/forms/producer-form";
import { ProgressStatus } from "@/components/progress-status";
import { ConfirmationForm } from "@/components/forms/confirmation-form";
import { z } from "zod";

interface PackageOp {
    Install?: PackageInfo;
    Replace?: [PackageMeta, PackageInfo];
    Remove?: PackageMeta;
}

export const BootPage = () => {
    const { data: config, refetch: refetchConfig } = useConfig();

    const [bootState, setBootState] = useState<BootState>();

    const { data: availablePackages } = useQuery<PackageInfo[]>({
        queryKey: queryKeys.packages,
        queryFn: () => getJson("/packages/index.json"),
        initialData: [],
    });

    const typeForm = useForm<InstallType>({
        defaultValues: { installType: "full" },
    });
    const servicesForm = useForm<ServicesType>();
    const producerForm = useForm<ProducerType>({
        defaultValues: { producer: config?.producer || "" },
    });

    const [currentPage, setCurrentPage] = useState<string>("type");

    const [packagesToInstall, setPackagesToInstall] = useState<PackageInfo[]>(
        []
    );

    const resolvePackages = (packageNamesRequeted: string[]) => {
        const fullDependencies = WrappedPackages.parse(
            wasm.js_resolve_packages(
                availablePackages,
                packageNamesRequeted,
                []
            )
        ).map((x) => x.Install);

        setPackagesToInstall(fullDependencies);
    };

    // return <ConfirmationForm packages={packagesToInstall} />;
    if (currentPage == "type") {
        return (
            <TypeForm
                setPackages={resolvePackages}
                typeForm={typeForm}
                setCurrentPage={setCurrentPage}
            />
        );
    } else if (currentPage == "services") {
        return (
            <ServicesForm
                setPackages={resolvePackages}
                serviceIndex={availablePackages}
                servicesForm={servicesForm}
                setCurrentPage={setCurrentPage}
            />
        );
    } else if (currentPage == "producer") {
        return (
            <ProducerForm
                producerForm={producerForm}
                typeForm={typeForm}
                setCurrentPage={setCurrentPage}
            />
        );
    } else if (currentPage == "install") {
        return (
            <InstallForm
                packages={packagesToInstall || []}
                config={config}
                refetchConfig={refetchConfig}
                producerForm={producerForm}
                setCurrentPage={setCurrentPage}
                setBootState={setBootState}
            />
        );
    } else if (currentPage == "go") {
        return <ProgressStatus state={bootState} />;
    }
};
