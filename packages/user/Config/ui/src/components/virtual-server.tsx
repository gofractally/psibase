import { useMemo } from "react";
import z from "zod";

import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

import { useAppForm } from "@/components/forms/app-form";
import { useNetworkVariables } from "@/hooks/use-network-variables";
import { useServerSpecs } from "@/hooks/use-server-specs";
import { useSetNetworkVariables } from "@/hooks/use-set-network-variables";
import { useSetServerSpecs } from "@/hooks/use-set-server-specs";

interface VirtualServerFormData {
    // Server Specs
    netBps: string; // Gbps input, converted to bytes/sec
    storageBytes: string; // GB input, converted to bytes
    // Network Variables
    blockReplayFactor: string; // u8 (0-255)
    perBlockSysCpuNs: string; // u64 (nanoseconds)
    objStorageBytes: string; // u64 (bytes)
    memoryRatio: string; // u8 (0-255)
}

export const VirtualServer = () => {
    const { mutateAsync: setServerSpecs } = useSetServerSpecs();
    const { mutateAsync: setNetworkVariables } = useSetNetworkVariables();
    const { data: serverSpecs } = useServerSpecs();
    const { data: networkVariables } = useNetworkVariables();

    // Compute initial values from fetched data
    const computedInitialValues = useMemo<VirtualServerFormData>(() => {
        if (serverSpecs && networkVariables) {
            // Convert bytes/sec to Gbps: divide by 125,000,000
            const netBpsGbps = (serverSpecs.netBps / 125_000_000).toString();
            // Convert bytes to GB: divide by 1,000,000,000
            const storageBytesGB = (serverSpecs.storageBytes / 1_000_000_000).toString();

            return {
                netBps: netBpsGbps,
                storageBytes: storageBytesGB,
                blockReplayFactor: networkVariables.blockReplayFactor.toString(),
                perBlockSysCpuNs: networkVariables.perBlockSysCpuNs.toString(),
                objStorageBytes: networkVariables.objStorageBytes.toString(),
                memoryRatio: networkVariables.memoryRatio.toString(),
            };
        }
        // Return empty values while loading
        return {
            netBps: "",
            storageBytes: "",
            blockReplayFactor: "",
            perBlockSysCpuNs: "",
            objStorageBytes: "",
            memoryRatio: "",
        };
    }, [serverSpecs, networkVariables]);

    // Zod schemas for validation
    const serverSpecsSchema = z.object({
        netBps: z.coerce.number().nonnegative("Net Bandwidth must be a positive number"),
        storageBytes: z.coerce.number().nonnegative("Storage must be a positive number"),
    });

    const networkVariablesSchema = z.object({
        blockReplayFactor: z.coerce.number().int().min(0).max(255, "Block replay factor must be between 0 and 255"),
        perBlockSysCpuNs: z.coerce.number().int().nonnegative("Per-block system CPU must be a positive integer"),
        objStorageBytes: z.coerce.number().int().nonnegative("Objective storage bytes must be a positive integer"),
        memoryRatio: z.coerce.number().int().min(0).max(255, "Memory ratio must be between 0 and 255"),
    });

    const form = useAppForm({
        defaultValues: computedInitialValues,
        onSubmit: async (data: { value: VirtualServerFormData }) => {
            // Parse and validate server specs
            const parsedSpecs = serverSpecsSchema.parse({
                netBps: data.value.netBps,
                storageBytes: data.value.storageBytes,
            });

            // Parse and validate network variables
            const parsedVars = networkVariablesSchema.parse({
                blockReplayFactor: data.value.blockReplayFactor,
                perBlockSysCpuNs: data.value.perBlockSysCpuNs,
                objStorageBytes: data.value.objStorageBytes,
                memoryRatio: data.value.memoryRatio,
            });

            // Convert Gbps to bytes per second: 1 Gbps = 1,000,000,000 bits/s = 125,000,000 bytes/s
            const netBpsBytes = Math.floor(parsedSpecs.netBps * 125_000_000);
            // Convert GB to bytes: 1 GB = 1,000,000,000 bytes
            const storageBytesValue = Math.floor(parsedSpecs.storageBytes * 1_000_000_000);

            // Submit server specs
            await setServerSpecs([
                {
                    netBps: netBpsBytes,
                    storageBytes: storageBytesValue,
                },
            ]);

            // Submit network variables
            await setNetworkVariables([
                {
                    blockReplayFactor: parsedVars.blockReplayFactor,
                    perBlockSysCpuNs: parsedVars.perBlockSysCpuNs,
                    objStorageBytes: parsedVars.objStorageBytes,
                    memoryRatio: parsedVars.memoryRatio,
                },
            ]);

            // Reset form with submitted values (cache updates will keep data in sync)
            form.reset(data.value);
        },
    });

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                form.handleSubmit();
            }}
        >
            <div className="rounded-lg border p-4">
                <div className="mb-4">
                    <h3 className="text-base font-medium">Virtual Server</h3>
                    <p className="text-muted-foreground text-sm">
                        Configure resource limits for the virtual server.
                    </p>
                </div>

                {/* Server Specs Subsection */}
                <div className="mb-6 border-b pb-6">
                    <h4 className="text-sm font-medium mb-4">Server Specs</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <form.Field
                            name="netBps"
                            validators={{
                                onChange: z
                                    .string()
                                    .refine(
                                        (val) => {
                                            if (!val) return true; // Allow empty for optional fields
                                            const num = Number(val);
                                            return !isNaN(num) && num >= 0;
                                        },
                                        {
                                            message: "Net Bandwidth must be a positive number",
                                        },
                                    ),
                            }}
                        >
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(field: any) => (
                                <div>
                                    <Label>Net Bandwidth (Gbps)</Label>
                                    <p className="text-muted-foreground text-sm">
                                        Bandwidth provides for P2P traffic, Tx traffic, and Query traffic.
                                    </p>
                                    <p className="text-muted-foreground text-sm">
                                        P2P traffic requires 100 Mbps per node.
                                    </p>
                                    <Input
                                        type="text"
                                        value={field.state.value}
                                        onChange={(e) => {
                                            field.handleChange(e.target.value);
                                        }}
                                        onBlur={field.handleBlur}
                                        placeholder="Gbps"
                                        className="mt-1 w-36"
                                    />
                                    {field.state.meta.errors && (
                                        <p className="text-destructive text-sm mt-1">
                                            {field.state.meta.errors[0]}
                                        </p>
                                    )}
                                </div>
                            )}
                        </form.Field>

                        <form.Field
                            name="storageBytes"
                            validators={{
                                onChange: z
                                    .string()
                                    .refine(
                                        (val) => {
                                            if (!val) return true; // Allow empty for optional fields
                                            const num = Number(val);
                                            return !isNaN(num) && num >= 0;
                                        },
                                        {
                                            message: "Storage must be a positive number",
                                        },
                                    ),
                            }}
                        >
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(field: any) => (
                                <div>
                                    <Label>Storage (GB)</Label>
                                    <p className="text-muted-foreground text-sm">
                                        Storage is the total storage space on the virtual server (RAM + SSD).
                                    </p>
                                    <Input
                                        type="text"
                                        value={field.state.value}
                                        onChange={(e) => {
                                            field.handleChange(e.target.value);
                                        }}
                                        onBlur={field.handleBlur}
                                        placeholder="GB"
                                        className="mt-1 w-36"
                                    />
                                    {field.state.meta.errors && (
                                        <p className="text-destructive text-sm mt-1">
                                            {field.state.meta.errors[0]}
                                        </p>
                                    )}
                                </div>
                            )}
                        </form.Field>
                    </div>
                </div>

                {/* Network Variables Subsection */}
                <div>
                    <h4 className="text-sm font-medium mb-4">Network Variables</h4>
                    <p className="text-muted-foreground text-sm mb-4">
                        These variables change how the network specs are derived from the server specs.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <form.Field
                            name="blockReplayFactor"
                            validators={{
                                onChange: z
                                    .string()
                                    .refine(
                                        (val) => {
                                            if (!val) return true;
                                            const num = Number(val);
                                            return !isNaN(num) && Number.isInteger(num) && num >= 0 && num <= 255;
                                        },
                                        {
                                            message: "Block replay factor must be an integer between 0 and 255",
                                        },
                                    ),
                            }}
                        >
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(field: any) => (
                                <div>
                                    <Label>Block Replay Factor</Label>
                                    <p className="text-muted-foreground text-sm">
                                        How much faster a node replays blocks compared to the live network.
                                    </p>
                                    <Input
                                        type="text"
                                        value={field.state.value}
                                        onChange={(e) => {
                                            field.handleChange(e.target.value);
                                        }}
                                        onBlur={field.handleBlur}
                                        placeholder="0-255"
                                        className="mt-1 w-36"
                                    />
                                    {field.state.meta.errors && (
                                        <p className="text-destructive text-sm mt-1">
                                            {field.state.meta.errors[0]}
                                        </p>
                                    )}
                                </div>
                            )}
                        </form.Field>

                        <form.Field
                            name="perBlockSysCpuNs"
                            validators={{
                                onChange: z
                                    .string()
                                    .refine(
                                        (val) => {
                                            if (!val) return true;
                                            const num = Number(val);
                                            return !isNaN(num) && Number.isInteger(num) && num >= 0;
                                        },
                                        {
                                            message: "Per-block system CPU must be a positive integer (nanoseconds)",
                                        },
                                    ),
                            }}
                        >
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(field: any) => (
                                <div>
                                    <Label>Per-Block System CPU (ns)</Label>
                                    <p className="text-muted-foreground text-sm">
                                        Amount of compute nanoseconds per second consumed by system functionality
                                        that is executed on each block (on_block callbacks, native consensus, etc.).
                                    </p>
                                    <Input
                                        type="text"
                                        value={field.state.value}
                                        onChange={(e) => {
                                            field.handleChange(e.target.value);
                                        }}
                                        onBlur={field.handleBlur}
                                        placeholder="nanoseconds"
                                        className="mt-1 w-36"
                                    />
                                    {field.state.meta.errors && (
                                        <p className="text-destructive text-sm mt-1">
                                            {field.state.meta.errors[0]}
                                        </p>
                                    )}
                                </div>
                            )}
                        </form.Field>

                        <form.Field
                            name="objStorageBytes"
                            validators={{
                                onChange: z
                                    .string()
                                    .refine(
                                        (val) => {
                                            if (!val) return true;
                                            const num = Number(val);
                                            return !isNaN(num) && Number.isInteger(num) && num >= 0;
                                        },
                                        {
                                            message: "Objective storage bytes must be a positive integer",
                                        },
                                    ),
                            }}
                        >
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(field: any) => (
                                <div>
                                    <Label>Objective Storage Bytes</Label>
                                    <p className="text-muted-foreground text-sm">
                                        Amount of storage space in bytes allocated to objective state.
                                    </p>
                                    <Input
                                        type="text"
                                        value={field.state.value}
                                        onChange={(e) => {
                                            field.handleChange(e.target.value);
                                        }}
                                        onBlur={field.handleBlur}
                                        placeholder="bytes"
                                        className="mt-1 w-36"
                                    />
                                    {field.state.meta.errors && (
                                        <p className="text-destructive text-sm mt-1">
                                            {field.state.meta.errors[0]}
                                        </p>
                                    )}
                                </div>
                            )}
                        </form.Field>

                        <form.Field
                            name="memoryRatio"
                            validators={{
                                onChange: z
                                    .string()
                                    .refine(
                                        (val) => {
                                            if (!val) return true;
                                            const num = Number(val);
                                            return !isNaN(num) && Number.isInteger(num) && num >= 0 && num <= 255;
                                        },
                                        {
                                            message: "Memory ratio must be an integer between 0 and 255",
                                        },
                                    ),
                            }}
                        >
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(field: any) => (
                                <div>
                                    <Label>Memory Ratio</Label>
                                    <p className="text-muted-foreground text-sm">
                                        Ratio of objective storage space to minimum memory in bytes per server, X:1.
                                        This is used to suggest a minimum amount of memory for node operators.
                                    </p>
                                    <Input
                                        type="text"
                                        value={field.state.value}
                                        onChange={(e) => {
                                            field.handleChange(e.target.value);
                                        }}
                                        onBlur={field.handleBlur}
                                        placeholder="0-255"
                                        className="mt-1 w-36"
                                    />
                                    {field.state.meta.errors && (
                                        <p className="text-destructive text-sm mt-1">
                                            {field.state.meta.errors[0]}
                                        </p>
                                    )}
                                </div>
                            )}
                        </form.Field>
                    </div>
                </div>

                {/* Update Button */}
                <div className="mt-6 flex flex-row-reverse font-medium">
                    <form.Subscribe
                        selector={(state) => [state.canSubmit, state.isDirty]}
                    >
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {([canSubmit, isDirty]: any) => (
                            <Button
                                type="submit"
                                disabled={!isDirty || !canSubmit}
                            >
                                Update
                            </Button>
                        )}
                    </form.Subscribe>
                </div>
            </div>
        </form>
    );
};

