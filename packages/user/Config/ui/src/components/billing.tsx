import { useRef } from "react";

import { Button } from "@shared/shadcn/ui/button";
import { Checkbox } from "@shared/shadcn/ui/checkbox";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

import { useAppForm } from "@/components/forms/app-form";
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
    const { mutateAsync: setEnableBilling } = useSetEnableBilling();
    const { mutateAsync: setFeeReceiverAccount } = useSetFeeReceiverAccount();

    const initialValues = useRef<BillingFormData>({
        enableBilling: false,
        tokenFeeReceiverAccount: "",
    });

    const form = useAppForm({
        defaultValues: initialValues.current,
        onSubmit: async (data: { value: BillingFormData }) => {
            // TODO: Implement save logic for billing fields
            console.log("Saving billing settings:", data.value);
            initialValues.current = { ...data.value };
            await setEnableBilling([data.value.enableBilling]);
            await setFeeReceiverAccount([data.value.tokenFeeReceiverAccount]);
            form.reset(data.value);
        },
    });

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
                <form.Field name="enableBilling">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {(field: any) => (
                        <>
                            <div className="mb-4">
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        checked={field.state.value}
                                        onCheckedChange={(checked) => {
                                            field.handleChange(!!checked);
                                        }}
                                    />
                                    <Label className="cursor-pointer">
                                        Enable billing (for public networks)
                                    </Label>
                                </div>
                            </div>

                            {field.state.value && (
                                <div className="space-y-4 mt-4">
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
                                </div>
                            )}
                        </>
                    )}
                </form.Field>

                <div className="mt-6 flex flex-row-reverse font-medium">
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

