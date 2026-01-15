import { useMemo, useState, useEffect } from "react";

import { Button } from "@shared/shadcn/ui/button";
import { Checkbox } from "@shared/shadcn/ui/checkbox";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

import { useAppForm } from "@/components/forms/app-form";
import { useBillingConfig } from "@/hooks/use-billing-config";
import { useSetEnableBilling } from "@/hooks/use-set-enable-billing";
import { useSetFeeReceiverAccount } from "@/hooks/use-set-fee-receiver-account";

interface SystemTokenInfo {
    id: string;
    symbol?: string;
}

interface BillingFormData {
    enableBilling: boolean;
    tokenFeeReceiverAccount: string;
}

interface BillingProps {
    systemToken: SystemTokenInfo | null;
    systemTokenLoading: boolean;
}

export const Billing = ({
    systemToken,
    systemTokenLoading,
}: BillingProps) => {
    const { mutateAsync: setFeeReceiverAccount } = useSetFeeReceiverAccount();
    const { mutateAsync: setEnableBilling } = useSetEnableBilling();
    const { data: billingConfig, isLoading: billingConfigLoading } = useBillingConfig();

    // Track the submitted/initial value of enableBilling for comparison
    const [submittedEnableBilling, setSubmittedEnableBilling] = useState<boolean | null>(null);

    const computedInitialValues = useMemo<BillingFormData>(() => {
        if (billingConfig) {
            return {
                enableBilling: billingConfig.enabled,
                tokenFeeReceiverAccount: billingConfig.feeReceiver || "",
            };
        }
        return {
            enableBilling: false,
            tokenFeeReceiverAccount: "",
        };
    }, [billingConfig]);

    useEffect(() => {
        if (billingConfig) {
            setSubmittedEnableBilling(billingConfig.enabled);
        } else {
            setSubmittedEnableBilling(false);
        }
    }, [billingConfig]);

    const form = useAppForm({
        defaultValues: computedInitialValues,
        onSubmit: async (data: { value: BillingFormData }) => {
            await setFeeReceiverAccount([data.value.tokenFeeReceiverAccount]);
            form.reset(data.value);
        },
    });

    const hasFeeReceiverAccount = useMemo(() => {
        return billingConfig?.feeReceiver != null && billingConfig.feeReceiver !== "";
    }, [billingConfig?.feeReceiver]);

    const handleApplyEnableBilling = async () => {
        await setEnableBilling([form.state.values.enableBilling]);
        setSubmittedEnableBilling(form.state.values.enableBilling);
        form.reset(form.state.values);
    };

    const isApplyEnabled = useMemo(() => {
        if (submittedEnableBilling === null) return false;
        return form.state.values.enableBilling !== submittedEnableBilling;
    }, [form.state.values.enableBilling, submittedEnableBilling]);


    if (billingConfigLoading) {
        return (
            <div className="rounded-lg border p-4">
                <div className="mb-4">
                    <h3 className="text-base font-medium">Billing</h3>
                </div>
                <p className="text-muted-foreground text-sm">Loading...</p>
            </div>
        );
    }

    return (
        <div className="rounded-lg border p-4">
            <div className="mb-4">
                <h3 className="text-base font-medium">Billing</h3>
            </div>

            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    form.handleSubmit();
                }}
            >
                <div className="space-y-4">
                    <div>
                        <Label>System Token</Label>
                        <p className="mt-1 text-sm">
                            {systemTokenLoading
                                ? "Loading..."
                                : systemToken
                                  ? systemToken.symbol || systemToken.id
                                  : "None"}
                        </p>
                    </div>

                    <form.Field name="tokenFeeReceiverAccount">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(accountField: any) => {
                            const currentValue = (accountField.state.value || "").trim();
                            const initialValue = (computedInitialValues.tokenFeeReceiverAccount || "").trim();
                            const isSaveEnabled = !hasFeeReceiverAccount && currentValue !== "" && currentValue !== initialValue;
                            
                            return (
                                <div>
                                    <Label>Token fee receiver account</Label>
                                    <Input
                                        type="text"
                                        value={accountField.state.value}
                                        onChange={(e) => {
                                            accountField.handleChange(e.target.value);
                                        }}
                                        onBlur={accountField.handleBlur}
                                        placeholder="Enter account name"
                                        className="mt-1"
                                        disabled={hasFeeReceiverAccount}
                                    />
                                    {!hasFeeReceiverAccount && (
                                        <div className="mt-2">
                                            <Button
                                                type="submit"
                                                disabled={!isSaveEnabled}
                                            >
                                                Save
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            );
                        }}
                    </form.Field>

                    <form.Field name="enableBilling">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(field: any) => (
                            <div>
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        checked={field.state.value}
                                        onCheckedChange={(checked) => {
                                            field.handleChange(!!checked);
                                        }}
                                        disabled={!hasFeeReceiverAccount}
                                    />
                                    <Label className="cursor-pointer">
                                        Enable billing (for public networks)
                                    </Label>
                                </div>
                                {hasFeeReceiverAccount && (
                                    <div className="mt-2">
                                        <Button
                                            type="button"
                                            onClick={handleApplyEnableBilling}
                                            disabled={!isApplyEnabled}
                                        >
                                            Apply
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}
                    </form.Field>
                </div>
            </form>
        </div>
    );
};

