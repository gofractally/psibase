import { useEffect } from "react";

import { useAddAsset } from "@/hooks/use-banx-mutations";
import { symbolValidators, useAppForm } from "@/lib/form";

import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

const MAX_DESCRIPTION_BYTES = 80;
const MAX_PRECISION = 8;

function descriptionError(value: string): string | undefined {
    const t = value.trim();
    if (!t) return "Required";
    if (new TextEncoder().encode(t).length > MAX_DESCRIPTION_BYTES) {
        return `Max ${MAX_DESCRIPTION_BYTES} bytes`;
    }
    return undefined;
}

function precisionError(value: number): string | undefined {
    if (!Number.isInteger(value) || value < 0 || value > MAX_PRECISION) {
        return `Must be an integer 0–${MAX_PRECISION}`;
    }
    return undefined;
}

export function AddAssetDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const addAsset = useAddAsset();

    const form = useAppForm({
        defaultValues: {
            symbol: "",
            precision: 4,
            description: "",
        },
        onSubmit: async ({ value }) => {
            await addAsset.mutateAsync({
                symbol: value.symbol.trim().toLowerCase(),
                precision: value.precision,
                description: value.description.trim(),
            });
            onOpenChange(false);
        },
    });

    useEffect(() => {
        if (!open) return;
        form.reset({
            symbol: "",
            precision: 4,
            description: "",
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>New asset</DialogTitle>
                    <DialogDescription>
                        Register a currency on Banx. Symbol is a chain name
                        (1–10 characters). Precision is fixed at 0–8 decimal
                        places.
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
                        name="symbol"
                        validators={symbolValidators()}
                        children={(field) => (
                            <field.TextField
                                label="Symbol"
                                placeholder="usd"
                                autoComplete="off"
                                required
                                description="Lowercase letters, numbers, and hyphens. Same rules as an account name."
                            />
                        )}
                    />
                    <form.AppField
                        name="precision"
                        validators={{
                            onChange: ({ value }) => precisionError(value),
                            onSubmit: ({ value }) => precisionError(value),
                        }}
                        children={(field) => (
                            <field.NumberField
                                label="Precision"
                                required
                                description="Decimal places (0–8). USD-style 4, BTC-style 8."
                            />
                        )}
                    />
                    <form.AppField
                        name="description"
                        validators={{
                            onChange: ({ value }) => descriptionError(value),
                            onSubmit: ({ value }) => descriptionError(value),
                        }}
                        children={(field) => (
                            <field.TextField
                                label="Description"
                                placeholder="United States dollar"
                                required
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
                        <form.AppForm>
                            <form.SubmitButton
                                labels={["Add asset", "Saving…"]}
                                loading={addAsset.isPending}
                            />
                        </form.AppForm>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
