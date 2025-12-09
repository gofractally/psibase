import { useMemo, useRef } from "react";
import z from "zod";

import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

import { useAppForm } from "@/components/forms/app-form";
import { useSetServerSpecs } from "@/hooks/use-set-server-specs";

interface VirtualServerFormData {
    netBandwidth: string;
    memory: string;
    storage: string;
    CPU: string;
}

export const VirtualServer = () => {
    const { mutateAsync: setServerSpecs } = useSetServerSpecs();

    const initialValues = useRef<VirtualServerFormData>({
        netBandwidth: "",
        memory: "",
        storage: "",
        CPU: "",
    });

    // Zod schema for validating and coercing form values to numbers
    const serverSpecsSchema = z.object({
        netBandwidth: z.coerce.number().int().nonnegative(),
        storage: z.coerce.number().int().nonnegative(),
    });

    const form = useAppForm({
        defaultValues: initialValues.current,
        onSubmit: async (data: { value: VirtualServerFormData }) => {
            // Parse and validate using Zod - this converts strings to numbers
            const parsed = serverSpecsSchema.parse({
                netBandwidth: data.value.netBandwidth,
                storage: data.value.storage,
            });

            console.log("Saving Virtual Server resources:", data.value);
            initialValues.current = { ...data.value };
            await setServerSpecs([parsed.netBandwidth, parsed.storage]);
            // await setNetworkVariables([data.value.blockReplayFactor, data.value.perBlockSysCPU, data.value.objStorageBytes, data.value.memoryRatio]);
            form.reset(data.value);
        },
    });

    // Track if Virtual Server section has changes
    const vsHasChanges = useMemo(() => {
        const current = form.state.values as VirtualServerFormData;
        const initial = initialValues.current;
        return (
            current.netBandwidth !== initial.netBandwidth ||
            current.memory !== initial.memory ||
            current.storage !== initial.storage ||
            current.CPU !== initial.CPU
        );
    }, [form.state.values]);

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                form.handleSubmit();
            }}
        >
            <div className="rounded-lg border p-4 hidden">
                <div className="mb-4">
                    <h3 className="text-base font-medium">Virtual Server v1</h3>
                    <p className="text-muted-foreground text-sm">
                        Configure resource limits for the virtual server.
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <form.Field
                        name="netBandwidth"
                        validators={{
                            onChange: z
                                .string()
                                .refine(
                                    (val) => {
                                        const num = Number(val);
                                        return !isNaN(num) && Number.isInteger(num) && num >= 0;
                                    },
                                    {
                                        message: "Net Bandwidth must be a positive integer",
                                    },
                                ),
                        }}
                    >
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(field: any) => (
                            <div>
                                <Label>Net Bandwidth (Gbits)</Label>
                                <Input
                                    type="text"
                                    value={field.state.value}
                                    onChange={(e) => {
                                        field.handleChange(e.target.value);
                                    }}
                                    onBlur={field.handleBlur}
                                    placeholder="Enter net bandwidth"
                                    className="mt-1"
                                />
                            </div>
                        )}
                    </form.Field>

                    <form.Field
                        name="memory"
                        validators={{
                            onChange: z
                                .string()
                                .refine(
                                    (val) => {
                                        const num = Number(val);
                                        return !isNaN(num) && Number.isInteger(num) && num >= 0;
                                    },
                                    {
                                        message: "Memory must be a positive integer",
                                    },
                                ),
                        }}
                    >
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(field: any) => (
                            <div>
                                <Label>Memory (GB)</Label>
                                <Input
                                    type="text"
                                    value={field.state.value}
                                    onChange={(e) => {
                                        field.handleChange(e.target.value);
                                    }}
                                    onBlur={field.handleBlur}
                                    placeholder="Enter memory"
                                    className="mt-1"
                                />
                            </div>
                        )}
                    </form.Field>

                    <form.Field
                        name="storage"
                        validators={{
                            onChange: z
                                .string()
                                .refine(
                                    (val) => {
                                        const num = Number(val);
                                        return !isNaN(num) && Number.isInteger(num) && num >= 0;
                                    },
                                    {
                                        message: "Storage must be a positive integer",
                                    },
                                ),
                        }}
                    >
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(field: any) => (
                            <div>
                                <Label>Storage (TB)</Label>
                                <Input
                                    type="text"
                                    value={field.state.value}
                                    onChange={(e) => {
                                        field.handleChange(e.target.value);
                                    }}
                                    onBlur={field.handleBlur}
                                    placeholder="Enter storage"
                                    className="mt-1"
                                />
                            </div>
                        )}
                    </form.Field>
                </div>
            </div>

            <div className="rounded-lg border p-4 mt-6">
                <div className="mb-4">
                    <h3 className="text-base font-medium">Virtual Server v2</h3>
                    <p className="text-muted-foreground text-sm">
                        Configure resource limits for the virtual server.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <form.Field name="CPU">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(field: any) => (
                            <div>
                                <Label>CPU</Label>
                                <p className="text-muted-foreground text-sm">
                                    CPU handles block production/tx processing, replay, and queries
                                </p>
                                <p className="text-muted-foreground text-sm mt-2">Block production: 1 core</p>
                                <span className="text-muted-foreground text-sm">Remaining node operations</span>
                                <Input
                                    type="text"
                                    value={field.state.value}
                                    onChange={(e) => {
                                        field.handleChange(e.target.value);
                                    }}
                                    onBlur={field.handleBlur}
                                    placeholder="# cores"
                                    className="mt-1 w-36"
                                />
                            </div>
                        )}
                    </form.Field>
                    <form.Field name="netBandwidth">
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
                            </div>
                        )}
                    </form.Field>

                    <form.Field name="memory">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(field: any) => (
                            <div>
                                <Label>Memory (GB)</Label>
                                <p className="text-muted-foreground text-sm">
                                    Memory is the primary in-memory home of the database.
                                </p>
                                <Input
                                    type="text"
                                    value={field.state.value}
                                    onChange={(e) => {
                                        field.handleChange(e.target.value);
                                    }}
                                    onBlur={field.handleBlur}
                                    placeholder="GBs"
                                    className="mt-1 w-36 inline"
                                />
                                <span className="text-muted-foreground text-sm ml-2">for in-memory cache</span>
                            </div>
                        )}
                    </form.Field>

                    <form.Field name="storage">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(field: any) => (
                            <div>
                                <Label>Storage (GB)</Label>
                                <p className="text-muted-foreground text-sm">
                                    Storage is the overflow home of database (when in-memory cache is fully utilitized).
                                </p>
                                <p>
                                <Input
                                    type="text"
                                    value={field.state.value}
                                    onChange={(e) => {
                                        field.handleChange(e.target.value);
                                    }}
                                    onBlur={field.handleBlur}
                                    placeholder="GBs"
                                    className="mt-1 w-36 inline"
                                />
                                <span className="text-muted-foreground text-sm ml-2">for pruneable data</span>
                                </p>
                                <p>
                                <Input
                                    type="text"
                                    value={field.state.value}
                                    onChange={(e) => {
                                        field.handleChange(e.target.value);
                                    }}
                                    onBlur={field.handleBlur}
                                    placeholder="GBs"
                                    className="mt-1 w-36 inline"
                                />
                                <span className="text-muted-foreground text-sm ml-2">for disk cache</span>
                                </p>
                            </div>
                        )}
                    </form.Field>
                </div>
            </div>

            <div className="mt-6 flex flex-row-reverse font-medium">
                <form.Subscribe>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {({ canSubmit }: any) => (
                        <Button
                            type="submit"
                            disabled={!vsHasChanges || !canSubmit}
                        >
                            Save
                        </Button>
                    )}
                </form.Subscribe>
            </div>
        </form>
    );
};

