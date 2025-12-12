import { useMemo, useRef } from "react";

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

    // Track if enableBilling checkbox has been toggled
    const enableBillingTouchedRef = useRef(false);

    // Compute initial values from fetched data
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

    const form = useAppForm({
        defaultValues: computedInitialValues,
        onSubmit: async (data: { value: BillingFormData }) => {
            // Save only the fee receiver account
            await setFeeReceiverAccount([data.value.tokenFeeReceiverAccount]);
            form.reset(data.value);
        },
    });

    // Check if fee receiver account is set (from query or after successful mutation)
    const hasFeeReceiverAccount = useMemo(() => {
        return billingConfig?.feeReceiver != null && billingConfig.feeReceiver !== "";
    }, [billingConfig?.feeReceiver]);

    // Handle Apply button for enable billing
    const handleApplyEnableBilling = async () => {
        await setEnableBilling([form.state.values.enableBilling]);
        enableBillingTouchedRef.current = false;
        // Reset form with current values (cache updates will keep data in sync)
        form.reset(form.state.values);
    };

    // Check if Apply button should be enabled
    const isApplyEnabled = enableBillingTouchedRef.current;

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
                        {(accountField: any) => (
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
                                />
                            </div>
                        )}
                    </form.Field>

                    <form.Field name="enableBilling">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(field: any) => (
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    checked={field.state.value}
                                    onCheckedChange={(checked) => {
                                        field.handleChange(!!checked);
                                        enableBillingTouchedRef.current = true;
                                    }}
                                    disabled={!hasFeeReceiverAccount}
                                />
                                <Label className="cursor-pointer">
                                    Enable billing (for public networks)
                                </Label>
                            </div>
                        )}
                    </form.Field>
                </div>

                <div className="mt-6 flex flex-row gap-2 font-medium">
                    {hasFeeReceiverAccount && (
                        <Button
                            type="button"
                            onClick={handleApplyEnableBilling}
                            disabled={!isApplyEnabled}
                        >
                            Apply
                        </Button>
                    )}
                    <form.Subscribe>
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {({ canSubmit }: any) => (
                            <Button
                                type="submit"
                                disabled={!canSubmit}
                            >
                                Save
                            </Button>
                        )}
                    </form.Subscribe>
                </div>
            </form>
        </div>
    );
};

