import { useNetworkVariables } from "@/hooks/use-network-variables";
import { useServerSpecs } from "@/hooks/use-server-specs";

import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@shared/shadcn/ui/tabs";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

const formatBytes = (bytes: number): string => {
    if (bytes >= 1e15) {
        return `${(bytes / 1e15).toFixed(2)} PB`;
    }
    if (bytes >= 1e12) {
        return `${(bytes / 1e12).toFixed(2)} TB`;
    }
    if (bytes >= 1e9) {
        return `${(bytes / 1e9).toFixed(2)} GB`;
    }
    return `${bytes} B`;
};

const formatBps = (bps: number): string => {
    if (bps >= 1e9) {
        return `${(bps / 1e9).toFixed(2)} Gbps`;
    }
    if (bps >= 1e6) {
        return `${(bps / 1e6).toFixed(2)} Mbps`;
    }
    if (bps >= 1e3) {
        return `${(bps / 1e3).toFixed(2)} Kbps`;
    }
    return `${bps} bps`;
};

export const Configuration = () => {
    const { data: serverSpecs, isLoading: isLoadingSpecs } = useServerSpecs();
    const { data: networkVariables, isLoading: isLoadingVars } =
        useNetworkVariables();

    const isLoading = isLoadingSpecs || isLoadingVars;

    const ramBytes =
        serverSpecs && networkVariables
            ? serverSpecs.storageBytes / networkVariables.memoryRatio
            : undefined;

    return (
        <div className="mx-auto w-full max-w-screen-lg space-y-6 px-2">
            <div>
                <h2 className="text-lg font-medium">Configuration</h2>
                <p className="text-muted-foreground text-sm">
                    Configure network settings and view node specifications.
                </p>
            </div>

            <Tabs defaultValue="services" className="w-full">
                <TabsList>
                    <TabsTrigger value="services">Services</TabsTrigger>
                    <TabsTrigger value="node-specs">Node Specs</TabsTrigger>
                </TabsList>
                <TabsContent value="services" className="space-y-4">
                    <div className="rounded-lg border p-4">
                        <p className="text-muted-foreground text-sm">
                            Services configuration will be available here.
                        </p>
                    </div>
                </TabsContent>
                <TabsContent value="node-specs" className="space-y-4">
                    <div className="rounded-lg border p-4 space-y-4">
                        {isLoading ? (
                            <div className="space-y-3">
                                <Skeleton className="h-6 w-32" />
                                <Skeleton className="h-6 w-32" />
                                <Skeleton className="h-6 w-32" />
                            </div>
                        ) : (
                            <>
                                <div className="flex justify-between items-center">
                                    <span className="text-sm font-medium">
                                        Bandwidth:
                                    </span>
                                    <span className="text-sm">
                                        {serverSpecs
                                            ? formatBps(serverSpecs.bandwidthBps)
                                            : "N/A"}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-sm font-medium">
                                        Storage:
                                    </span>
                                    <span className="text-sm">
                                        {serverSpecs
                                            ? formatBytes(
                                                  serverSpecs.storageBytes,
                                              )
                                            : "N/A"}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-sm font-medium">
                                        RAM:
                                    </span>
                                    <span className="text-sm">
                                        {ramBytes
                                            ? formatBytes(ramBytes)
                                            : "N/A"}
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
};

