import { useEffect } from "react";

import { AssetField, ExpiresField } from "@/components/form-fields";
import {
    useRemoveGlobalRoutingPolicy,
    useRemoveRoutingPolicy,
    useSetGlobalRoutingPolicy,
    useSetRoutingPolicy,
} from "@/hooks/use-banx-mutations";
import {
    MAX_HOP_FEE_PERCENT,
    MAX_HOP_FEE_PPM,
    MAX_PERCENT,
    MIN_PERCENT_STEP,
    PPM_SCALE,
    percentFieldValidator,
    percentStringToPpm,
    useAppForm,
} from "@/lib/form";
import type { Asset } from "@/lib/graphql";

import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export type RoutingPolicyPrefill = {
    /** Next-hop creditor → open **override** dialog. Omit for **global**. */
    creditor?: string;
    assetId?: number;
};

type FeeFields = {
    assetId: number | undefined;
    hopFeeFixed: string;
    hopFeePct: string;
    maxAcceptPct: string;
    expiresAtSeconds: number;
};

const defaultFees = (assetId?: number): FeeFields => ({
    assetId,
    hopFeeFixed: "0",
    hopFeePct: "0",
    maxAcceptPct: "100",
    expiresAtSeconds: 0,
});

function feePayload(value: FeeFields) {
    return {
        assetId: value.assetId!,
        hopFeeFixed: value.hopFeeFixed.trim(),
        hopFeePercentPpm: percentStringToPpm(value.hopFeePct, MAX_HOP_FEE_PPM),
        maxAcceptRatePpm: percentStringToPpm(value.maxAcceptPct, PPM_SCALE),
        expiresAtSeconds: value.expiresAtSeconds,
    };
}

const hopFeeValidators = {
    onChange: percentFieldValidator(MAX_HOP_FEE_PERCENT),
    onSubmit: percentFieldValidator(MAX_HOP_FEE_PERCENT),
};

const aprValidators = {
    onChange: percentFieldValidator(MAX_PERCENT),
    onSubmit: percentFieldValidator(MAX_PERCENT),
};

/**
 * Global routing (header) — fee form only, no account.
 * Override (row) — switch on: fee form + save; switch off: no fields, Save removes.
 */
export function RoutingPolicyDialog({
    open,
    onOpenChange,
    assets,
    prefill,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assets: Asset[];
    prefill?: RoutingPolicyPrefill | null;
}) {
    const creditor = prefill?.creditor?.trim() ?? "";
    const isOverride = !!creditor;

    const setGlobalRouting = useSetGlobalRoutingPolicy();
    const setRouting = useSetRoutingPolicy();
    const removeGlobal = useRemoveGlobalRoutingPolicy();
    const removeOverride = useRemoveRoutingPolicy();

    const globalForm = useAppForm({
        defaultValues: defaultFees(prefill?.assetId),
        onSubmit: async ({ value }) => {
            if (value.assetId === undefined) return;
            await new Promise<void>((resolve, reject) => {
                setGlobalRouting.mutate(feePayload(value), {
                    onSuccess: () => {
                        onOpenChange(false);
                        resolve();
                    },
                    onError: (e: Error) => reject(e),
                });
            });
        },
    });

    const overrideForm = useAppForm({
        defaultValues: {
            enabled: true,
            ...defaultFees(prefill?.assetId),
        },
        onSubmit: async ({ value }) => {
            const assetId = value.assetId ?? prefill?.assetId;
            if (assetId === undefined) return;

            if (!value.enabled) {
                await new Promise<void>((resolve, reject) => {
                    removeOverride.mutate(
                        { creditor, assetId },
                        {
                            onSuccess: () => {
                                onOpenChange(false);
                                resolve();
                            },
                            onError: (e: Error) => reject(e),
                        },
                    );
                });
                return;
            }

            await new Promise<void>((resolve, reject) => {
                setRouting.mutate(
                    { creditor, ...feePayload({ ...value, assetId }) },
                    {
                        onSuccess: () => {
                            onOpenChange(false);
                            resolve();
                        },
                        onError: (e: Error) => reject(e),
                    },
                );
            });
        },
    });

    useEffect(() => {
        if (!open) return;
        if (isOverride) {
            overrideForm.reset({
                enabled: true,
                ...defaultFees(prefill?.assetId),
            });
        } else {
            globalForm.reset(defaultFees(prefill?.assetId));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, isOverride, prefill?.assetId, creditor]);

    // ── Override (opened from an account row) ─────────────────────────
    if (isOverride) {
        const pending = setRouting.isPending || removeOverride.isPending;
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Routing override</DialogTitle>
                        <DialogDescription>
                            Hop fees when you path-pay via next-hop{" "}
                            <strong>{creditor}</strong>. Turn off and Save to
                            remove this override.
                        </DialogDescription>
                    </DialogHeader>
                    <form
                        className="grid gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void overrideForm.handleSubmit();
                        }}
                    >
                        <overrideForm.AppField
                            name="enabled"
                            children={(field) => (
                                <field.SwitchField
                                    label={`Override for ${creditor}`}
                                />
                            )}
                        />

                        <overrideForm.Subscribe
                            selector={(s) => s.values.enabled}
                            children={(enabled) =>
                                enabled ? (
                                    <>
                                        <overrideForm.Field
                                            name="assetId"
                                            children={(field) => (
                                                <AssetField
                                                    assets={assets}
                                                    value={field.state.value}
                                                    onChange={(id) =>
                                                        field.handleChange(id)
                                                    }
                                                />
                                            )}
                                        />
                                        <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                                            <overrideForm.AppField
                                                name="hopFeeFixed"
                                                children={(field) => (
                                                    <field.TextField
                                                        label="Hop fee fixed"
                                                        inputMode="decimal"
                                                    />
                                                )}
                                            />
                                            <overrideForm.AppField
                                                name="hopFeePct"
                                                validators={hopFeeValidators}
                                                children={(field) => (
                                                    <field.TextField
                                                        label="Hop fee %"
                                                        inputMode="decimal"
                                                        min={0}
                                                        max={
                                                            MAX_HOP_FEE_PERCENT
                                                        }
                                                        step={MIN_PERCENT_STEP}
                                                    />
                                                )}
                                            />
                                        </div>
                                        <overrideForm.AppField
                                            name="maxAcceptPct"
                                            validators={aprValidators}
                                            children={(field) => (
                                                <field.TextField
                                                    label="Max accept APR %"
                                                    inputMode="decimal"
                                                    min={0}
                                                    max={MAX_PERCENT}
                                                    step={MIN_PERCENT_STEP}
                                                />
                                            )}
                                        />
                                        <overrideForm.Field
                                            name="expiresAtSeconds"
                                            children={(field) => (
                                                <ExpiresField
                                                    value={field.state.value}
                                                    onChange={(v) =>
                                                        field.handleChange(v)
                                                    }
                                                />
                                            )}
                                        />
                                    </>
                                ) : null
                            }
                        />

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onOpenChange(false)}
                            >
                                Cancel
                            </Button>
                            <overrideForm.Subscribe
                                selector={(s) => s.values}
                                children={(values) => {
                                    const assetId =
                                        values.assetId ?? prefill?.assetId;
                                    return (
                                        <overrideForm.AppForm>
                                            <overrideForm.SubmitButton
                                                labels={
                                                    values.enabled
                                                        ? [
                                                              "Save override",
                                                              "Saving…",
                                                          ]
                                                        : [
                                                              "Remove override",
                                                              "Removing…",
                                                          ]
                                                }
                                                loading={pending}
                                                disabled={assetId === undefined}
                                            />
                                        </overrideForm.AppForm>
                                    );
                                }}
                            />
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        );
    }

    // ── Global (header) — never an account field ──────────────────────
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Global routing policy</DialogTitle>
                    <DialogDescription>
                        Default hop fees for any next hop in this asset.
                        Per-creditor overrides are set from an account row.
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="grid gap-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void globalForm.handleSubmit();
                    }}
                >
                    <globalForm.Field
                        name="assetId"
                        children={(field) => (
                            <AssetField
                                assets={assets}
                                value={field.state.value}
                                onChange={(id) => field.handleChange(id)}
                            />
                        )}
                    />
                    <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                        <globalForm.AppField
                            name="hopFeeFixed"
                            children={(field) => (
                                <field.TextField
                                    label="Hop fee fixed"
                                    inputMode="decimal"
                                />
                            )}
                        />
                        <globalForm.AppField
                            name="hopFeePct"
                            validators={hopFeeValidators}
                            children={(field) => (
                                <field.TextField
                                    label="Hop fee %"
                                    inputMode="decimal"
                                    min={0}
                                    max={MAX_HOP_FEE_PERCENT}
                                    step={MIN_PERCENT_STEP}
                                />
                            )}
                        />
                    </div>
                    <globalForm.AppField
                        name="maxAcceptPct"
                        validators={aprValidators}
                        children={(field) => (
                            <field.TextField
                                label="Max accept APR %"
                                inputMode="decimal"
                                min={0}
                                max={MAX_PERCENT}
                                step={MIN_PERCENT_STEP}
                            />
                        )}
                    />
                    <globalForm.Field
                        name="expiresAtSeconds"
                        children={(field) => (
                            <ExpiresField
                                value={field.state.value}
                                onChange={(v) => field.handleChange(v)}
                            />
                        )}
                    />
                    <DialogFooter className="gap-2 sm:justify-between">
                        <globalForm.Subscribe
                            selector={(s) => s.values.assetId}
                            children={(assetId) => (
                                <Button
                                    type="button"
                                    variant="destructive"
                                    disabled={
                                        setGlobalRouting.isPending ||
                                        removeGlobal.isPending ||
                                        assetId === undefined
                                    }
                                    onClick={() => {
                                        if (assetId === undefined) return;
                                        removeGlobal.mutate(
                                            { assetId },
                                            {
                                                onSuccess: () =>
                                                    onOpenChange(false),
                                            },
                                        );
                                    }}
                                >
                                    {removeGlobal.isPending
                                        ? "Removing…"
                                        : "Remove global"}
                                </Button>
                            )}
                        />
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onOpenChange(false)}
                            >
                                Cancel
                            </Button>
                            <globalForm.Subscribe
                                selector={(s) => s.values.assetId}
                                children={(assetId) => (
                                    <globalForm.AppForm>
                                        <globalForm.SubmitButton
                                            labels={[
                                                "Save global routing",
                                                "Saving…",
                                            ]}
                                            loading={setGlobalRouting.isPending}
                                            disabled={assetId === undefined}
                                        />
                                    </globalForm.AppForm>
                                )}
                            />
                        </div>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
