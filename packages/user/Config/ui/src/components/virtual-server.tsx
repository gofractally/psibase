import { useMemo } from "react";
import type React from "react";
import z from "zod";
import { Info } from "lucide-react";

import { Button } from "@shared/shadcn/ui/button";
import { Label } from "@shared/shadcn/ui/label";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@shared/shadcn/ui/accordion";

import { useAppForm } from "@shared/components/form/app-form";
import { useSetNetworkVariables } from "@/hooks/use-set-network-variables";
import { useSetServerSpecs } from "@/hooks/use-set-server-specs";
import { useVirtualServerResources } from "@/hooks/use-virtual-server-resources";

import { parseError } from "@shared/lib/parseErrorMessage";
import {
    STORAGE_FACTORS,
    TIME_FACTORS,
    getBestStorageUnit,
    getBestTimeUnit,
    type StorageUnit,
    type TimeUnit,
} from "@/lib/unit-conversions";
import { PerBlockSysCpuUnitSelect, StorageUnitSelect } from "@/components/unit-select";

/** Pattern for partial decimal input (e.g. ".", ".5", "0.") while typing */
const PARTIAL_DECIMAL = /^\d*\.?\d*$/;

/** Refine for non-negative number that allows partial decimal input */
const nonNegativeNumberRefine = (val: string) => {
    if (!val || PARTIAL_DECIMAL.test(val)) return true;
    const num = Number(val);
    return !isNaN(num) && num >= 0;
};

/** Refine for integer in [0,255] that allows partial input */
const blockReplayFactorRefine = (val: string) => {
    if (!val || /^\d*$/.test(val)) return true;
    const num = Number(val);
    return !isNaN(num) && Number.isInteger(num) && num >= 0 && num <= 255;
};

interface VirtualServerFormData {
    // Server Specs (form values in user-chosen units)
    netGbps: string; // Network bandwidth in Gbps
    storageAmount: string; // Total storage in storageUnit
    storageUnit: StorageUnit; // Storage unit (GB, TB, PB)
    // Network Variables
    blockReplayFactor: string; // u8 (0-255)
    perBlockSysCpu: string; // Per-block system CPU in perBlockSysCpuUnit
    perBlockSysCpuUnit: TimeUnit; // Time unit (ns, us, ms)
    objStorageAmount: string; // Objective storage in objStorageUnit
    objStorageUnit: StorageUnit; // Obj storage unit (GB, TB, PB)
}

export const VirtualServer = () => {
    const {
        mutateAsync: setServerSpecs,
        error: serverSpecsError,
        isError: serverSpecsIsError,
    } = useSetServerSpecs();
    const {
        mutateAsync: setNetworkVariables,
        error: networkVarsError,
        isError: networkVarsIsError,
    } = useSetNetworkVariables();
    const { data: resources } = useVirtualServerResources();
    const serverSpecs = resources?.serverSpecs;
    const networkVariables = resources?.networkVariables;
    const cpuAvailableUnits = resources?.cpuAvailableUnits ?? 0;

    // Compute initial values from fetched data
    const computedInitialValues = useMemo<VirtualServerFormData>(() => {
        if (serverSpecs && networkVariables) {
            // Convert bits/sec to Gbps: divide by 1e9
            const netBpsGbps = (serverSpecs.netBps / 1_000_000_000).toString();
            
            // Auto-select best storage unit for storageBytes
            const storageUnitData = getBestStorageUnit(serverSpecs.storageBytes);
            
            // Auto-select best time unit for perBlockSysCpuNs
            const timeUnitData = getBestTimeUnit(networkVariables.perBlockSysCpuNs);
            
            // Auto-select best storage unit for objStorageBytes
            const objStorageUnitData = getBestStorageUnit(networkVariables.objStorageBytes);

            return {
                netGbps: netBpsGbps,
                storageAmount: storageUnitData.value.toString(),
                storageUnit: storageUnitData.unit,
                blockReplayFactor: networkVariables.blockReplayFactor.toString(),
                perBlockSysCpu: timeUnitData.value.toString(),
                perBlockSysCpuUnit: timeUnitData.unit,
                objStorageAmount: objStorageUnitData.value.toString(),
                objStorageUnit: objStorageUnitData.unit,
            };
        }
        // Return empty values while loading
        return {
            netGbps: "",
            storageAmount: "",
            storageUnit: "GB",
            blockReplayFactor: "",
            perBlockSysCpu: "",
            perBlockSysCpuUnit: "ns",
            objStorageAmount: "",
            objStorageUnit: "GB",
        };
    }, [serverSpecs, networkVariables]);

    // Zod schemas for validation
    const serverSpecsSchema = z.object({
        netGbps: z.coerce.number().nonnegative("Net Bandwidth must be a positive number"),
        storageAmount: z.coerce.number().nonnegative("Storage must be a positive number"),
    });

    const networkVariablesSchema = z.object({
        blockReplayFactor: z.coerce.number().int().min(0).max(255, "Block replay factor must be between 0 and 255"),
        perBlockSysCpu: z.coerce.number().nonnegative("Per-block system CPU must be a positive number"),
        objStorageAmount: z.coerce.number().nonnegative("Objective storage must be a positive number"),
    });

    const form = useAppForm({
        defaultValues: computedInitialValues,
        onSubmit: async (data: { value: VirtualServerFormData }) => {
            // Parse and validate server specs
            const parsedSpecs = serverSpecsSchema.parse({
                netGbps: data.value.netGbps,
                storageAmount: data.value.storageAmount,
            });

            // Parse and validate network variables
            const parsedVars = networkVariablesSchema.parse({
                blockReplayFactor: data.value.blockReplayFactor,
                perBlockSysCpu: data.value.perBlockSysCpu,
                objStorageAmount: data.value.objStorageAmount,
            });

            // Convert Gbps to bits/sec: 1 Gbps = 1e9 bits/sec
            const netBps = Math.floor(parsedSpecs.netGbps * 1_000_000_000);

            // Convert storage value from selected unit to bytes
            const storageBytesValue = Math.floor(
                parsedSpecs.storageAmount * STORAGE_FACTORS[data.value.storageUnit]
            );

            // Submit server specs
            await setServerSpecs([
                {
                    netBps: netBps,
                    storageBytes: storageBytesValue,
                },
            ]);

            // Convert per-block system CPU from selected unit to nanoseconds
            const perBlockSysCpuNsValue = Math.floor(
                parsedVars.perBlockSysCpu * TIME_FACTORS[data.value.perBlockSysCpuUnit]
            );

            // Convert obj storage value from selected unit to bytes
            const objStorageBytesValue = Math.floor(
                parsedVars.objStorageAmount * STORAGE_FACTORS[data.value.objStorageUnit]
            );

            // Submit network variables
            await setNetworkVariables([
                {
                    blockReplayFactor: parsedVars.blockReplayFactor,
                    perBlockSysCpuNs: perBlockSysCpuNsValue,
                    objStorageBytes: objStorageBytesValue,
                },
            ]);

            // Reset form with submitted values (cache updates will keep data in sync)
            form.reset(data.value);
        },
    });

    // Helper for labels with an info tooltip
    const LabelWithInfo = ({
        label,
        tooltip,
    }: {
        label: string;
        tooltip: string;
    }) => (
        <div className="inline-flex items-center gap-1">
            <Label>{label}</Label>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent>{tooltip}</TooltipContent>
            </Tooltip>
        </div>
    );

    const txError =
        serverSpecsIsError && serverSpecsError
            ? parseError(serverSpecsError)
            : networkVarsIsError && networkVarsError
              ? parseError(networkVarsError)
              : null;

    const updateButton = (
        <div className="mt-1 flex flex-row font-medium">
            <form.Subscribe selector={(state) => [state.canSubmit, state.isDirty]}>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {([canSubmit, isDirty]: any) => (
                    <Button type="submit" disabled={!isDirty || !canSubmit}>
                        Update
                    </Button>
                )}
            </form.Subscribe>
        </div>
    );

    return (
        <form.AppForm>
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
                <div className="mb-0 border-b pb-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <form.AppField
                            name="netGbps"
                            validators={{
                                onChange: z
                                    .string()
                                    .refine(nonNegativeNumberRefine, {
                                        message: "Net Bandwidth must be a positive number",
                                    }),
                            }}
                        >
                            {(field) => (
                                <div>
                                    <LabelWithInfo
                                        label="Net bandwidth"
                                        tooltip="for P2P traffic, Tx traffic, and Query traffic"
                                    />
                                    <div className="mt-1 flex items-center gap-2">
                                        <field.TextField
                                            label={undefined}
                                            description={undefined}
                                            placeholder="0"
                                            className="w-36"
                                        />
                                        <div className="text-muted-foreground text-sm">
                                            Gbps
                                        </div>
                                    </div>
                                </div>
                            )}
                        </form.AppField>
                        <form.AppField
                            name="storageAmount"
                            validators={{
                                onChange: z
                                    .string()
                                    .refine(nonNegativeNumberRefine, {
                                        message: "Storage must be a positive number",
                                    }),
                            }}
                        >
                            {(field) => (
                                <div>
                                    <LabelWithInfo
                                        label="Total storage"
                                        tooltip="Total storage space (objective + subjective)"
                                    />
                                    <div className="mt-1 flex items-center gap-2">
                                        <field.TextField
                                            label={undefined}
                                            description={undefined}
                                            placeholder="0"
                                            className="w-36"
                                        />
                                        <form.Field name="storageUnit">
                                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                            {(unitField: any) => (
                                                <div className="mt-2">
                                                    <StorageUnitSelect
                                                        value={unitField.state.value}
                                                        onChange={(value) => {
                                                            unitField.handleChange(value);
                                                        }}
                                                    />
                                                </div>
                                            )}
                                        </form.Field>
                                    </div>
                                </div>
                            )}
                        </form.AppField>
                    </div>
                </div>

                {/* Network Variables Subsection */}
                <div>
                    <Accordion
                        type="single"
                        collapsible
                    >
                        <AccordionItem value="advanced">
                            <AccordionTrigger className="!flex-none !justify-start flex-row-reverse w-fit">
                                Advanced
                            </AccordionTrigger>
                            <AccordionContent>
                                <p className="text-destructive text-xs mb-3">
                                    WARNING: These are advanced features; ensure you know
                                    the implications of changing these values!
                                </p>
                                <h4 className="text-sm font-medium mb-2">
                                    Network variables
                                </h4>
                                <p className="text-muted-foreground text-sm mb-4">
                                    These variables change how the network specs are derived
                                    from the server specs.
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <form.AppField
                                        name="blockReplayFactor"
                                        validators={{
                                            onChange: z
                                                .string()
                                                .refine(blockReplayFactorRefine, {
                                                    message: "Block replay factor must be an integer between 0 and 255",
                                                }),
                                        }}
                                    >
                                        {(field) => (
                                            <field.TextField
                                                label="Block Replay Factor"
                                                description="Block replay speed compared to live network processing"
                                                placeholder="0-255"
                                                className="mt-1 w-36"
                                            />
                                        )}
                                    </form.AppField>

                                    <form.AppField
                                        name="perBlockSysCpu"
                                        validators={{
                                            onChange: z
                                                .string()
                                                .refine(nonNegativeNumberRefine, {
                                                    message: "Per-block system CPU must be a positive number",
                                                }),
                                        }}
                                    >
                                        {(field) => (
                                            <div>
                                                <Label>Per-Block System CPU</Label>
                                                <p className="text-muted-foreground text-sm">
                                                    CPU devoted to system execution
                                                </p>
                                                <div className="mt-1 flex items-center gap-2">
                                                    <field.TextField
                                                        label={undefined}
                                                        description={undefined}
                                                        placeholder="0"
                                                        className="w-36"
                                                    />
                                                    <form.Field name="perBlockSysCpuUnit">
                                                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                        {(unitField: any) => (
                                                            <div className="mt-2">
                                                                <PerBlockSysCpuUnitSelect
                                                                    value={unitField.state.value}
                                                                    onChange={(value) => {
                                                                        unitField.handleChange(value);
                                                                    }}
                                                                />
                                                            </div>
                                                        )}
                                                    </form.Field>
                                                </div>
                                            </div>
                                        )}
                                    </form.AppField>

                                    <form.AppField
                                        name="objStorageAmount"
                                        validators={{
                                            onChange: z
                                                .string()
                                                .refine(nonNegativeNumberRefine, {
                                                    message: "Objective storage must be a positive number",
                                                }),
                                        }}
                                    >
                                        {(field) => (
                                            <div>
                                                <Label>Objective Storage</Label>
                                                <p className="text-muted-foreground text-sm">
                                                    Storage devoted to objective state (vs subjective
                                                    state)
                                                </p>
                                                <div className="mt-1 flex items-center gap-2">
                                                    <field.TextField
                                                        label={undefined}
                                                        description={undefined}
                                                        placeholder="0"
                                                        className="w-36"
                                                    />
                                                    <form.Field name="objStorageUnit">
                                                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                        {(unitField: any) => (
                                                            <div className="mt-2">
                                                                <StorageUnitSelect
                                                                    value={unitField.state.value}
                                                                    onChange={(value) => {
                                                                        unitField.handleChange(value);
                                                                    }}
                                                                />
                                                            </div>
                                                        )}
                                                    </form.Field>
                                                </div>
                                            </div>
                                        )}
                                    </form.AppField>

                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </div>

                <>
                    {txError && (
                        <p className="text-destructive text-sm mt-2">{txError}</p>
                    )}
                    {updateButton}
                </>

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
                            const value = parseFloat(formValues.storageAmount || "0");
                            if (isNaN(value)) return 0;
                            const unit = (formValues.storageUnit || "GB") as StorageUnit;
                            return value * STORAGE_FACTORS[unit];
                        };

                        const getObjStorageBytes = (): number => {
                            const value = parseFloat(formValues.objStorageAmount || "0");
                            if (isNaN(value)) return 0;
                            const unit = (formValues.objStorageUnit || "GB") as StorageUnit;
                            return value * STORAGE_FACTORS[unit];
                        };

                        // const getPerBlockSysCpuNs = (): number => {
                        //     const value = parseFloat(formValues.perBlockSysCpu || "0");
                        //     if (isNaN(value)) return 0;
                        //     const unit = (formValues.perBlockSysCpuUnit || "ns") as TimeUnit;
                        //     return value * TIME_FACTORS[unit];
                        // };

                        // const getBlockReplayFactor = (): number => {
                        //     return parseFloat(formValues.blockReplayFactor || "0") || 0;
                        // };

                        // Calculate derived values (in base units)
                        const storageBytes = getStorageBytes();
                        const objStorageBytes = getObjStorageBytes();
                        // const perBlockSysCpuNs = getPerBlockSysCpuNs();
                        // const blockReplayFactor = getBlockReplayFactor();

                        // Server-derived values (not form state); display only
                        // Bandwidth: server net capacity in Gbps (netBps / 1e9)
                        const netGbps =
                            serverSpecs != null
                                ? serverSpecs.netBps / 1_000_000_000
                                : 0;
                        const cpuForTxNs = cpuAvailableUnits;
                        const cpuForTxDisplay = getBestTimeUnit(cpuForTxNs);

                        const objStorageDisplay = getBestStorageUnit(objStorageBytes);
                        const subjectiveStorageBytes = Math.max(0, storageBytes - objStorageBytes);
                        const subjectiveStorageDisplay = getBestStorageUnit(subjectiveStorageBytes);

                        return (
                            <div className="border-t mt-2 pt-2">
                                <div className="border rounded p-2 m-1">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="col-span-1 md:col-span-2">
                                            <div className="text-sm">Billable Resources</div>
                                            <p className="text-muted-foreground text-xs mt-1">
                                                These values are automatically computed and take into account many variables, such as the virtual server specs, advanced variables, number of infrastructure providers, etc.
                                            </p>
                                        </div>

                                        {/* Row 1 (desktop): Objective / Subjective storage */}
                                        <div className="text-sm">
                                            <div>
                                                <span className="text-muted-foreground">
                                                    Objective Storage:
                                                </span>{" "}
                                                {`${formatNumber(objStorageDisplay.value)} ${objStorageDisplay.unit}`}
                                            </div>
                                        </div>

                                        <div className="text-sm">
                                            <div>
                                                <span className="text-muted-foreground">
                                                    Subjective Storage:
                                                </span>{" "}
                                                {`${formatNumber(subjectiveStorageDisplay.value)} ${subjectiveStorageDisplay.unit}`}
                                            </div>
                                        </div>

                                        {/* Row 2 (desktop): CPU / Bandwidth */}
                                        <div className="text-sm">
                                            <div>
                                                <span className="text-muted-foreground">
                                                    CPU for transactions:
                                                </span>{" "}
                                                {`${formatNumber(cpuForTxDisplay.value)} ${cpuForTxDisplay.unit}`}
                                            </div>
                                        </div>

                                        <div className="text-sm">
                                            <div>
                                                <span className="text-muted-foreground">Bandwidth:</span>{" "}
                                                {`${formatNumber(netGbps)} Gbps`}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    }}
                </form.Subscribe>
            </div>
        </form>
        </form.AppForm>
    );
};








