import { useEffect } from "react";

import { AssetField, ExpiresField } from "@/components/form-fields";
import {
    useSetGlobalRoutingPolicy,
    useSetRoutingPolicy,
} from "@/hooks/use-banx-mutations";
import { percentStringToPpm, useAppForm } from "@/lib/form";
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
    /** Next-hop creditor; empty = global policy. */
    creditor?: string;
    assetId?: number;
};

type RoutingFormValues = {
    creditor: string;
    assetId: number | undefined;
    hopFeeFixed: string;
    hopFeePct: string;
    maxAcceptPct: string;
    expiresAtSeconds: number;
};

const emptyValues = (
    prefill?: RoutingPolicyPrefill | null,
): RoutingFormValues => ({
    creditor: prefill?.creditor?.trim() ?? "",
    assetId: prefill?.assetId,
    hopFeeFixed: "0",
    hopFeePct: "0",
    maxAcceptPct: "100",
    expiresAtSeconds: 0,
});

/**
 * Post global or per-creditor same-asset routing (path hop fees).
 * Used from Policies and Accounts (route icon).
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
    const setGlobalRouting = useSetGlobalRoutingPolicy();
    const setRouting = useSetRoutingPolicy();
    const pending = setGlobalRouting.isPending || setRouting.isPending;

    const form = useAppForm({
        defaultValues: emptyValues(prefill),
        onSubmit: async ({ value }) => {
            if (value.assetId === undefined) return;
            const fees = {
                assetId: value.assetId,
                hopFeeFixed: value.hopFeeFixed.trim(),
                hopFeePercentPpm: percentStringToPpm(value.hopFeePct),
                maxAcceptRatePpm: percentStringToPpm(value.maxAcceptPct),
                expiresAtSeconds: value.expiresAtSeconds,
            };
            const creditor = value.creditor.trim();
            await new Promise<void>((resolve, reject) => {
                const opts = {
                    onSuccess: () => {
                        onOpenChange(false);
                        resolve();
                    },
                    onError: (e: Error) => reject(e),
                };
                if (creditor) {
                    setRouting.mutate({ creditor, ...fees }, opts);
                } else {
                    setGlobalRouting.mutate(fees, opts);
                }
            });
        },
    });

    useEffect(() => {
        if (!open) return;
        form.reset(emptyValues(prefill));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open/prefill only
    }, [open, prefill?.creditor, prefill?.assetId]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Set routing policy</DialogTitle>
                    <DialogDescription>
                        Same-asset path hop fees. Leave next-hop blank for a{" "}
                        <strong>global</strong> policy (all lines in this
                        asset). Fill next-hop for a per-creditor override.
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="grid gap-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void form.handleSubmit();
                    }}
                >
                    <form.AppField
                        name="creditor"
                        children={(field) => (
                            <field.TextField
                                label="Next-hop creditor (optional)"
                                placeholder="empty = global"
                            />
                        )}
                    />
                    <form.Field
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
                        <form.AppField
                            name="hopFeeFixed"
                            children={(field) => (
                                <field.TextField
                                    label="Hop fee fixed"
                                    inputMode="decimal"
                                />
                            )}
                        />
                        <form.AppField
                            name="hopFeePct"
                            children={(field) => (
                                <field.TextField
                                    label="Hop fee %"
                                    inputMode="decimal"
                                />
                            )}
                        />
                    </div>
                    <form.AppField
                        name="maxAcceptPct"
                        children={(field) => (
                            <field.TextField
                                label="Max accept APR %"
                                inputMode="decimal"
                            />
                        )}
                    />
                    <form.Field
                        name="expiresAtSeconds"
                        children={(field) => (
                            <ExpiresField
                                value={field.state.value}
                                onChange={(v) => field.handleChange(v)}
                            />
                        )}
                    />
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <form.Subscribe
                            selector={(s) => s.values}
                            children={(values) => {
                                const isOverride = !!values.creditor.trim();
                                return (
                                    <form.AppForm>
                                        <form.SubmitButton
                                            labels={
                                                isOverride
                                                    ? [
                                                          "Save override",
                                                          "Saving…",
                                                      ]
                                                    : [
                                                          "Save global routing",
                                                          "Saving…",
                                                      ]
                                            }
                                            loading={pending}
                                            disabled={
                                                values.assetId === undefined
                                            }
                                        />
                                    </form.AppForm>
                                );
                            }}
                        />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
