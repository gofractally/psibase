import { useMemo } from "react";
import type React from "react";
import z from "zod";
import { Info } from "lucide-react";

import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

import { useAppForm } from "@/components/forms/app-form";
import { useNetworkVariables } from "@/hooks/use-network-variables";
import { useServerSpecs } from "@/hooks/use-server-specs";
import { useSetNetworkVariables } from "@/hooks/use-set-network-variables";
import { useSetServerSpecs } from "@/hooks/use-set-server-specs";

type StorageUnit = "GB" | "TB" | "PB";
type TimeUnit = "ns" | "us" | "ms";

interface VirtualServerFormData {
    // Server Specs
    netBps: string; // Gbps input, converted to bytes/sec
    storageBytes: string; // Storage input value
    storageUnit: StorageUnit; // Storage unit (GB, TB, PB)
    // Network Variables
    blockReplayFactor: string; // u8 (0-255)
    perBlockSysCpuNs: string; // Per-block system CPU input value
    perBlockSysCpuUnit: TimeUnit; // Time unit (ns, us, ms)
    objStorageBytes: string; // Obj storage input value
    objStorageUnit: StorageUnit; // Obj storage unit (GB, TB, PB)
    memoryRatio: string; // u8 (0-255)
}

// Conversion factors
const STORAGE_FACTORS: Record<StorageUnit, number> = {
    GB: 1_000_000_000, // 1e9
    TB: 1_000_000_000_000, // 1e12
    PB: 1_000_000_000_000_000, // 1e15
};

const TIME_FACTORS: Record<TimeUnit, number> = {
    ns: 1,
    us: 1_000, // 1e3
    ms: 1_000_000, // 1e6
};

// Helper function to determine the best storage unit for a value (between 1-999)
function getBestStorageUnit(bytes: number): { value: number; unit: StorageUnit } {
    if (bytes === 0) return { value: 0, unit: "GB" };
    
    // Try PB first
    const pbValue = bytes / STORAGE_FACTORS.PB;
    if (pbValue >= 1 && pbValue < 1000) {
        return { value: pbValue, unit: "PB" };
    }
    
    // Try TB
    const tbValue = bytes / STORAGE_FACTORS.TB;
    if (tbValue >= 1 && tbValue < 1000) {
        return { value: tbValue, unit: "TB" };
    }
    
    // Default to GB
    const gbValue = bytes / STORAGE_FACTORS.GB;
    return { value: gbValue, unit: "GB" };
}

// Helper function to determine the best time unit for a value (between 1-999)
function getBestTimeUnit(nanoseconds: number): { value: number; unit: TimeUnit } {
    if (nanoseconds === 0) return { value: 0, unit: "ns" };
    
    // Try ms first
    const msValue = nanoseconds / TIME_FACTORS.ms;
    if (msValue >= 1 && msValue < 1000) {
        return { value: msValue, unit: "ms" };
    }
    
    // Try us
    const usValue = nanoseconds / TIME_FACTORS.us;
    if (usValue >= 1 && usValue < 1000) {
        return { value: usValue, unit: "us" };
    }
    
    // Default to ns
    return { value: nanoseconds, unit: "ns" };
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
            
            // Auto-select best storage unit for storageBytes
            const storageUnitData = getBestStorageUnit(serverSpecs.storageBytes);
            
            // Auto-select best time unit for perBlockSysCpuNs
            const timeUnitData = getBestTimeUnit(networkVariables.perBlockSysCpuNs);
            
            // Auto-select best storage unit for objStorageBytes
            const objStorageUnitData = getBestStorageUnit(networkVariables.objStorageBytes);

            return {
                netBps: netBpsGbps,
                storageBytes: storageUnitData.value.toString(),
                storageUnit: storageUnitData.unit,
                blockReplayFactor: networkVariables.blockReplayFactor.toString(),
                perBlockSysCpuNs: timeUnitData.value.toString(),
                perBlockSysCpuUnit: timeUnitData.unit,
                objStorageBytes: objStorageUnitData.value.toString(),
                objStorageUnit: objStorageUnitData.unit,
                memoryRatio: networkVariables.memoryRatio.toString(),
            };
        }
        // Return empty values while loading
        return {
            netBps: "",
            storageBytes: "",
            storageUnit: "GB",
            blockReplayFactor: "",
            perBlockSysCpuNs: "",
            perBlockSysCpuUnit: "ns",
            objStorageBytes: "",
            objStorageUnit: "GB",
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
        perBlockSysCpuNs: z.coerce.number().nonnegative("Per-block system CPU must be a positive number"),
        objStorageBytes: z.coerce.number().nonnegative("Objective storage must be a positive number"),
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
            console.info("sending parsedVars:", parsedVars);

            // Convert Gbps to bytes per second: 1 Gbps = 1,000,000,000 bits/s = 125,000,000 bytes/s
            const netBpsBytes = Math.floor(parsedSpecs.netBps * 125_000_000);
            
            // Convert storage value from selected unit to bytes
            const storageBytesValue = Math.floor(
                parsedSpecs.storageBytes * STORAGE_FACTORS[data.value.storageUnit]
            );

            // Submit server specs
            await setServerSpecs([
                {
                    netBps: netBpsBytes,
                    storageBytes: storageBytesValue,
                },
            ]);

            // Convert per-block system CPU from selected unit to nanoseconds
            const perBlockSysCpuNsValue = Math.floor(
                parsedVars.perBlockSysCpuNs * TIME_FACTORS[data.value.perBlockSysCpuUnit]
            );
            
            // Convert obj storage value from selected unit to bytes
            const objStorageBytesValue = Math.floor(
                parsedVars.objStorageBytes * STORAGE_FACTORS[data.value.objStorageUnit]
            );

            // Submit network variables
            await setNetworkVariables([
                {
                    blockReplayFactor: parsedVars.blockReplayFactor,
                    perBlockSysCpuNs: perBlockSysCpuNsValue,
                    objStorageBytes: objStorageBytesValue,
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
                </div>

                {/* Server Specs Subsection */}
                <div className="mb-0 border-b pb-6">
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
                                        for P2P traffic, Tx traffic, and Query traffic
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
                                    <Label>Storage</Label>
                                    <p className="text-muted-foreground text-sm">
                                        Total storage space (RAM + SSD)
                                    </p>
                                    <div className="mt-1 flex gap-2 items-center">
                                        <Input
                                            type="text"
                                            value={field.state.value}
                                            onChange={(e) => {
                                                field.handleChange(e.target.value);
                                            }}
                                            onBlur={field.handleBlur}
                                            placeholder="0"
                                            className="w-36"
                                        />
                                        <form.Field name="storageUnit">
                                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                            {(unitField: any) => (
                                                <Select
                                                    value={unitField.state.value}
                                                    onValueChange={(value) => {
                                                        unitField.handleChange(value as StorageUnit);
                                                    }}
                                                >
                                                    <SelectTrigger className="w-20">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="GB">GB</SelectItem>
                                                        <SelectItem value="TB">TB</SelectItem>
                                                        <SelectItem value="PB">PB</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        </form.Field>
                                    </div>
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
                    <h4 className="text-sm font-medium mb-2">Network Variables</h4>
                    <p className="text-muted-foreground text-sm mb-4">
                        These variables change how the network specs are derived from the server specs
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
                                        Block replay speed compared to live network processing
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
                                            return !isNaN(num) && num >= 0;
                                        },
                                        {
                                            message: "Per-block system CPU must be a positive number",
                                        },
                                    ),
                            }}
                        >
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(field: any) => (
                                <div>
                                    <Label>Per-Block System CPU</Label>
                                    <p className="text-muted-foreground text-sm">
                                        CPU devoted to system execution
                                    </p>
                                    <div className="mt-1 flex gap-2 items-center">
                                        <Input
                                            type="text"
                                            value={field.state.value}
                                            onChange={(e) => {
                                                field.handleChange(e.target.value);
                                            }}
                                            onBlur={field.handleBlur}
                                            placeholder="0"
                                            className="w-36"
                                        />
                                        <form.Field name="perBlockSysCpuUnit">
                                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                            {(unitField: any) => (
                                                <Select
                                                    value={unitField.state.value}
                                                    onValueChange={(value) => {
                                                        unitField.handleChange(value as TimeUnit);
                                                    }}
                                                >
                                                    <SelectTrigger className="w-20">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="ns">ns</SelectItem>
                                                        <SelectItem value="us">us</SelectItem>
                                                        <SelectItem value="ms">ms</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        </form.Field>
                                    </div>
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
                                            return !isNaN(num) && num >= 0;
                                        },
                                        {
                                            message: "Objective storage must be a positive number",
                                        },
                                    ),
                            }}
                        >
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(field: any) => (
                                <div>
                                    <Label>Objective Storage</Label>
                                    <p className="text-muted-foreground text-sm">
                                        Storage devoted to objective state (vs subjective state)
                                    </p>
                                    <div className="mt-1 flex gap-2 items-center">
                                        <Input
                                            type="text"
                                            value={field.state.value}
                                            onChange={(e) => {
                                                field.handleChange(e.target.value);
                                            }}
                                            onBlur={field.handleBlur}
                                            placeholder="0"
                                            className="w-36"
                                        />
                                        <form.Field name="objStorageUnit">
                                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                            {(unitField: any) => (
                                                <Select
                                                    value={unitField.state.value}
                                                    onValueChange={(value) => {
                                                        unitField.handleChange(value as StorageUnit);
                                                    }}
                                                >
                                                    <SelectTrigger className="w-20">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="GB">GB</SelectItem>
                                                        <SelectItem value="TB">TB</SelectItem>
                                                        <SelectItem value="PB">PB</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        </form.Field>
                                    </div>
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
                                        Ratio of objective storage to minimum memory, X:1
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
                <div className="mt-1 flex flex-row font-medium">
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

                {/* Network Resources Display */}
                <form.Subscribe selector={(state) => state.values}>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {(formValues: any) => {
                        // Helper to format numbers
                        const formatNumber = (num: number, decimals: number = 2): string => {
                            if (isNaN(num) || !isFinite(num)) return "—";
                            return num.toFixed(decimals);
                        };

                        // Convert form values to base units (bytes, nanoseconds)
                        const getStorageBytes = (): number => {
                            const value = parseFloat(formValues.storageBytes || "0");
                            if (isNaN(value)) return 0;
                            const unit = (formValues.storageUnit || "GB") as StorageUnit;
                            return value * STORAGE_FACTORS[unit];
                        };

                        const getObjStorageBytes = (): number => {
                            const value = parseFloat(formValues.objStorageBytes || "0");
                            if (isNaN(value)) return 0;
                            const unit = (formValues.objStorageUnit || "GB") as StorageUnit;
                            return value * STORAGE_FACTORS[unit];
                        };

                        const getPerBlockSysCpuNs = (): number => {
                            const value = parseFloat(formValues.perBlockSysCpuNs || "0");
                            if (isNaN(value)) return 0;
                            const unit = (formValues.perBlockSysCpuUnit || "ns") as TimeUnit;
                            return value * TIME_FACTORS[unit];
                        };

                        const getMemoryRatio = (): number => {
                            return parseFloat(formValues.memoryRatio || "0") || 0;
                        };

                        const getBlockReplayFactor = (): number => {
                            return parseFloat(formValues.blockReplayFactor || "0") || 0;
                        };

                        // Calculate derived values
                        const storageBytes = getStorageBytes();
                        const objStorageBytes = getObjStorageBytes();
                        const perBlockSysCpuNs = getPerBlockSysCpuNs();
                        const memoryRatio = getMemoryRatio();
                        const blockReplayFactor = getBlockReplayFactor();

                        // Network Resources
                        const storageDisplay = getBestStorageUnit(storageBytes);
                        const cpuDisplay = getBestTimeUnit(perBlockSysCpuNs);
                        const netBps = parseFloat(formValues.netBps || "0") || 0;

                        // Resource Allocation
                        const ramBytes = memoryRatio > 0 ? objStorageBytes / memoryRatio : 0;
                        const ramDisplay = getBestStorageUnit(ramBytes);
                        const objStorageDisplay = getBestStorageUnit(objStorageBytes);
                        const subjectiveStorageBytes = Math.max(0, storageBytes - objStorageBytes);
                        const subjectiveStorageDisplay = getBestStorageUnit(subjectiveStorageBytes);
                        
                        // CPU for transactions: (1sec - perBlockSysCpuNs) / blockReplayFactor
                        const oneSecondNs = 1_000_000_000; // 1 second in nanoseconds
                        const cpuForTxNs = blockReplayFactor > 0 
                            ? (oneSecondNs - perBlockSysCpuNs) / blockReplayFactor 
                            : 0;
                        const cpuForTxDisplay = getBestTimeUnit(cpuForTxNs);

                        // Helper component for value with info icon
                        const ValueWithInfo = ({ 
                            value, 
                            tooltipText 
                        }: { 
                            value: React.ReactNode; 
                            tooltipText?: string;
                        }) => {
                            if (!tooltipText) {
                                return <>{value}</>;
                            }
                            return (
                                <span className="inline-flex items-center gap-1">
                                    {value}
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {tooltipText}
                                        </TooltipContent>
                                    </Tooltip>
                                </span>
                            );
                        };

                        return (
                            <div className="border-t mt-2 pt-2">
                                <div className="border rounded p-2 m-1">
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="col-span-3">
                                            <div className="text-sm">Resultant Network Resources</div>
                                        </div>

                                        <div className="text-sm">
                                            <div>
                                                <span className="text-muted-foreground">Storage:</span>{" "}
                                                <ValueWithInfo
                                                    value={`${formatNumber(storageDisplay.value)} ${storageDisplay.unit}`}
                                                />
                                            </div>
                                        </div>

                                        <div className="text-sm">
                                            <div>
                                                <span className="text-muted-foreground">CPU:</span>{" "}
                                                <ValueWithInfo
                                                    value={`${formatNumber(cpuDisplay.value)} ${cpuDisplay.unit}`}
                                                />
                                            </div>
                                        </div>

                                        <div className="text-sm">
                                            <div>
                                                <span className="text-muted-foreground">Bandwidth:</span>{" "}
                                                <ValueWithInfo
                                                    value={`${formatNumber(netBps)} Gbps`}
                                                />
                                            </div>
                                        </div>

                                        <div className="col-span-3 mt-1">
                                            <div className="text-sm">Allocation</div>
                                        </div>

                                        <div className="text-sm">
                                            <div>
                                                <span className="text-muted-foreground">RAM:</span>{" "}
                                                <ValueWithInfo
                                                    value={`${formatNumber(ramDisplay.value)} ${ramDisplay.unit}`}
                                                    tooltipText="= Objective Storage / Memory Ratio"
                                                />
                                            </div>
                                        </div>

                                        <div className="text-sm">
                                            <div>
                                                <span className="text-muted-foreground">Objective Storage:</span>{" "}
                                                <ValueWithInfo
                                                    value={`${formatNumber(objStorageDisplay.value)} ${objStorageDisplay.unit}`}
                                                    tooltipText="= Objective Storage"
                                                />
                                            </div>
                                        </div>

                                        <div className="text-sm">
                                            <div>
                                                <span className="text-muted-foreground">Subjective Storage:</span>{" "}
                                                <ValueWithInfo
                                                    value={`${formatNumber(subjectiveStorageDisplay.value)} ${subjectiveStorageDisplay.unit}`}
                                                    tooltipText="= Storage - Objective Storage"
                                                />
                                            </div>
                                        </div>

                                        <div className="text-sm">
                                            <div>
                                                <span className="text-muted-foreground">CPU for system work:</span>{" "}
                                                <ValueWithInfo
                                                    value={`${formatNumber(cpuDisplay.value)} ${cpuDisplay.unit}`}
                                                    tooltipText="= per-block-sys-cpu-ns"
                                                />
                                            </div>
                                        </div>

                                        <div className="text-sm">
                                            <div>
                                                <span className="text-muted-foreground">CPU for transactions:</span>{" "}
                                                <ValueWithInfo
                                                    value={`${formatNumber(cpuForTxDisplay.value)} ${cpuForTxDisplay.unit}`}
                                                    tooltipText="= (1sec - per-block-sys-cpu-ns) / block-replay-factor"
                                                />
                                            </div>
                                        </div>

                                        {/* Empty cell for alignment */}
                                        <div></div>
                                    </div>
                                </div>
                            </div>
                        );
                    }}
                </form.Subscribe>
            </div>
        </form>
    );
};

