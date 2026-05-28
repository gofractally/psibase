import { useStore } from "@tanstack/react-form";
import { useState } from "react";
import { z } from "zod";

import { prompt } from "@psibase/common-lib";

import { BrandedGlowingCard } from "@shared/components/branded-glowing-card";
import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import { useBranding } from "@shared/hooks/use-branding";
import { useCanCreatePremiumAccount } from "@shared/hooks/use-can-create-premium-account";
import { useSystemToken } from "@shared/hooks/use-system-token";
import { b64ToPem, pemToB64, validateB64 } from "@shared/lib/b64-key-utils";
import { getAccount } from "@shared/lib/get-account";
import { fetchCurrentPriceForLength } from "@shared/lib/graphql/prem-accounts";
import { Quantity } from "@shared/lib/quantity";
import {
    MAX_ACCOUNT_NAME_LENGTH,
    MIN_FREE_ACCOUNT_NAME_LENGTH,
    zAccount,
    zAccountFree,
} from "@shared/lib/schemas/account";
import { Button } from "@shared/shadcn/ui/button";
import {
    CardAction,
    CardContent,
    CardDescription,
    CardFooter,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Checkbox } from "@shared/shadcn/ui/checkbox";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Progress } from "@shared/shadcn/ui/progress";
import { Spinner } from "@shared/shadcn/ui/spinner";

import { CopyButton } from "./components/copy-button";
import { BuyNameConfirmationDialog } from "./components/create-prompt/buy-name-confirmation-dialog";
import { Loader } from "./components/create-prompt/loader";
import { DownloadKeyFileButton } from "./components/download-key-file-button";
import { PasswordVisibilityButton } from "./components/password-visibility-button";
import { useConnectAccount } from "./hooks/use-connect-account";
import { useCreateAccount } from "./hooks/use-create-account";
import { useImportExisting } from "./hooks/use-import-existing";
import { usePurchaseAccount } from "./hooks/use-purchase-account";

const DEFAULT_NAME_PURCHASE_SLIPPAGE = 5;

export const CreatePrompt = () => {
    const [key, setKey] = useState<string>("");
    const [step, setStep] = useState<"1_CREATE" | "2_SAVE" | "3_CONFIRM">(
        "1_CREATE",
    );
    const [showPassword, setShowPassword] = useState(false);
    const [acknowledged, setAcknowledged] = useState(false);
    const [buyConfirmOpen, setBuyConfirmOpen] = useState(false);
    const [price, setPrice] = useState<Quantity | null>(null);

    const { data: networkName } = useBranding();
    const { data: systemToken, isPending: isPendingSystemToken } =
        useSystemToken();

    const {
        data: canCreatePremiumAccount,
        isPending: isPendingCanCreatePremiumAccount,
    } = useCanCreatePremiumAccount();
    const isLoading = isPendingSystemToken || isPendingCanCreatePremiumAccount;

    const importExistingMutation = useImportExisting();
    const createAccountMutation = useCreateAccount();
    const purchaseAccountMutation = usePurchaseAccount();
    const connectAccountMutation = useConnectAccount();

    const accountValidator = canCreatePremiumAccount ? zAccount : zAccountFree;

    const createForm = useAppForm({
        defaultValues: {
            account: "",
        },
        validators: {
            onSubmit: z.object({
                account: accountValidator,
            }),
            onSubmitAsync: async ({ value }) => {
                const account = await getAccount(value.account);
                return {
                    fields: {
                        account: account
                            ? "This account name is not available"
                            : undefined,
                    },
                };
            },
        },
        onSubmit: async (data) => {
            if (price) {
                setBuyConfirmOpen(true);
                return;
            }
            await handleCreateOrBuy(data.value.account);
        },
    });

    const handleCreateOrBuy = async (account: string) => {
        const name = account.trim();
        if (!name) return;
        try {
            let privateKey: string;
            if (price) {
                privateKey = await purchaseAccountMutation.mutateAsync([
                    name,
                    DEFAULT_NAME_PURCHASE_SLIPPAGE,
                ]);
            } else {
                privateKey = await createAccountMutation.mutateAsync(name);
            }
            setKey(pemToB64(privateKey));
            setBuyConfirmOpen(false);
            setStep("2_SAVE");
        } catch (error) {
            setBuyConfirmOpen(false);
            console.error("Failed to secure account:");
            console.error(
                error instanceof Error ? error.message : "Unknown error",
            );
            if (
                error instanceof Error &&
                error.message.includes("Invalid account name")
            ) {
                createForm.fieldInfo.account.instance?.setErrorMap({
                    onSubmit: "This account name is not available",
                });
            } else if (
                error instanceof Error &&
                error.message.includes("has insufficient balance")
            ) {
                createForm.fieldInfo.account.instance?.setErrorMap({
                    onSubmit: "Insufficient balance",
                });
            } else if (
                error instanceof Error &&
                error.message.includes("Max cost below current ask")
            ) {
                createForm.fieldInfo.account.instance?.setErrorMap({
                    onSubmit:
                        "Market price changed; check new price and try again",
                });
            } else {
                createForm.fieldInfo.account.instance?.setErrorMap({
                    onSubmit: "An unknown error occurred",
                });
            }
        }
    };

    const createdAccount = useStore(
        createForm.store,
        (state) => state.values.account,
    );

    const importForm = useAppForm({
        defaultValues: {
            account: {
                account: "",
            },
            privateKey: "",
        },
        validators: {
            onChange: z.object({
                account: z.object({
                    account: zAccount.or(z.literal("")),
                }),
                privateKey: z.string(),
            }),
            onSubmit: z.object({
                account: z.object({
                    account: zAccount.refine(
                        (val) => val.trim() === createdAccount?.trim(),
                        {
                            message:
                                "Account name must match the account name you just created",
                        },
                    ),
                }),
                privateKey: z.string().refine(
                    (val) => {
                        return validateB64(val);
                    },
                    {
                        message: "Private key must be a valid base64 string",
                    },
                ),
            }),
        },
        onSubmit: async (data) => {
            await handleImportAndLogin(
                data.value.account.account.trim(),
                data.value.privateKey,
            );
        },
    });

    const handleImportAndLogin = async (account: string, b64: string) => {
        const pemFormatted = b64ToPem(b64);

        try {
            await importExistingMutation.mutateAsync({
                account: account,
                key: pemFormatted,
            });
            await connectAccountMutation.mutateAsync(account);
            prompt.finished();
        } catch (e) {
            console.error("Import and login failed");
            console.error(e);
            importForm.fieldInfo.privateKey.instance?.setErrorMap({
                onSubmit:
                    "Error signing in. Check your private key and try again.",
            });
        }
    };

    if (isLoading) {
        return <Loader />;
    }

    const validateAccountOnChangeAsync = async ({
        value: rawValue,
    }: {
        value: string;
    }) => {
        try {
            const value = accountValidator.parse(rawValue);

            const account = await getAccount(value);
            const exists = Boolean(account?.accountNum);
            if (exists) return "Account name is already taken";

            if (
                canCreatePremiumAccount &&
                value.length < MIN_FREE_ACCOUNT_NAME_LENGTH
            ) {
                const freshPrice = await fetchCurrentPriceForLength(
                    value.length,
                );
                if (!freshPrice) {
                    return `${value.length} character account names are not available`;
                }

                if (!systemToken) throw new Error("System token not found");

                const priceQuantity = new Quantity(
                    freshPrice,
                    systemToken.precision,
                    Number(systemToken.id),
                    systemToken.symbol,
                );
                setPrice(priceQuantity);
            }
        } catch (e) {
            if (e instanceof z.ZodError) return;
            console.error("Failed to validate account name");
            console.error(e);
            return "Failed to validate account name. Please try again.";
        }
    };

    const priceLabel = () => (
        <createForm.Subscribe selector={(state) => [state.isFieldsValidating]}>
            {([isFieldsValidating]) =>
                isFieldsValidating ? (
                    <Spinner className="size-3.5 shrink-0" />
                ) : price ? (
                    <Label className="text-green-500">
                        Market price: {price.format({ includeLabel: true })}
                    </Label>
                ) : undefined
            }
        </createForm.Subscribe>
    );

    return (
        <BrandedGlowingCard>
            <div className="-mt-6 px-6">
                <Progress
                    value={
                        step === "1_CREATE" ? 33 : step === "2_SAVE" ? 67 : 100
                    }
                />
            </div>
            {step === "1_CREATE" && (
                <createForm.AppForm>
                    <form
                        id="create-account-form"
                        onSubmit={(e) => {
                            e.preventDefault();
                            createForm.handleSubmit();
                        }}
                        className="flex flex-col gap-6"
                    >
                        <CardContent className="flex flex-col">
                            <div className="mb-6 flex-1 space-y-2">
                                <CardTitle className="text-3xl font-normal">
                                    Create a {networkName} account
                                </CardTitle>
                                <CardDescription>
                                    {canCreatePremiumAccount
                                        ? `Account names can be up to ${MAX_ACCOUNT_NAME_LENGTH} characters long, must start with a letter, and can only contain letters, numbers, and underscores.`
                                        : `Account names can be ${MIN_FREE_ACCOUNT_NAME_LENGTH}-${MAX_ACCOUNT_NAME_LENGTH} characters long, must start with a letter, and can only contain letters, numbers, and underscores.`}
                                </CardDescription>
                            </div>
                            <createForm.AppField
                                name="account"
                                children={(field) => (
                                    <field.TextField
                                        label="Account name"
                                        placeholder="Account name"
                                        autoComplete="off"
                                        autoCorrect="off"
                                        spellCheck={false}
                                        rightLabel={priceLabel()}
                                    />
                                )}
                                asyncDebounceMs={500}
                                validators={{
                                    onChange: () => {
                                        if (canCreatePremiumAccount)
                                            setPrice(null);
                                    },
                                    onChangeAsync: validateAccountOnChangeAsync,
                                }}
                            />
                        </CardContent>
                        <CardFooter className="flex flex-1 justify-end">
                            <CardAction>
                                <createForm.SubmitButton
                                    labels={
                                        price
                                            ? ["Buy now", "Buying..."]
                                            : ["Create", "Creating..."]
                                    }
                                    disabled={
                                        price
                                            ? purchaseAccountMutation.isPending
                                            : false
                                    }
                                />
                            </CardAction>
                        </CardFooter>
                    </form>
                    {price ? (
                        <BuyNameConfirmationDialog
                            open={buyConfirmOpen}
                            setOpen={setBuyConfirmOpen}
                            account={createdAccount}
                            price={price}
                            slippage={DEFAULT_NAME_PURCHASE_SLIPPAGE}
                            isLoading={purchaseAccountMutation.isPending}
                            onConfirm={() => handleCreateOrBuy(createdAccount)}
                        />
                    ) : null}
                </createForm.AppForm>
            )}

            {step === "2_SAVE" && (
                <>
                    <CardContent className="flex flex-col gap-8">
                        <div>
                            <CardTitle className="text-3xl font-normal">
                                Secure your {networkName} account
                            </CardTitle>
                            <CardDescription>
                                Your{" "}
                                <span className="font-semibold">
                                    Private Key
                                </span>{" "}
                                serves as your account password allowing you to
                                sign into your account from any browser or
                                device.{" "}
                                <span className="font-semibold">
                                    Store it safely and securely
                                </span>
                                , as it cannot be recovered if you lose it.
                            </CardDescription>
                        </div>
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-2">
                                <Label>Account Name</Label>
                                <div className="mb-2 flex gap-2">
                                    <div className="relative flex-1">
                                        <Input
                                            type="text"
                                            value={createdAccount}
                                            readOnly
                                            onFocus={(e) => e.target.select()}
                                        />
                                        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-1">
                                            <CopyButton
                                                text={createdAccount}
                                                ariaLabel="Copy account name"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <Label>Private Key</Label>
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <Input
                                            type={
                                                showPassword
                                                    ? "text"
                                                    : "password"
                                            }
                                            value={key}
                                            readOnly
                                            className="pr-24"
                                            onFocus={(e) => e.target.select()}
                                        />
                                        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-1">
                                            <PasswordVisibilityButton
                                                showPassword={showPassword}
                                                onToggle={() =>
                                                    setShowPassword(
                                                        !showPassword,
                                                    )
                                                }
                                            />
                                            <DownloadKeyFileButton
                                                pemContent={b64ToPem(key)}
                                                filename={`${createdAccount}.pem`}
                                            />
                                            <CopyButton
                                                text={key}
                                                ariaLabel="Copy private key"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <Label className="hover:bg-accent/50 flex items-start gap-3 rounded-lg border p-3 has-[[aria-checked=true]]:border-blue-600 has-[[aria-checked=true]]:bg-blue-50 dark:has-[[aria-checked=true]]:border-blue-900 dark:has-[[aria-checked=true]]:bg-blue-950">
                                <Checkbox
                                    id="acknowledge"
                                    checked={acknowledged}
                                    onCheckedChange={(checked) =>
                                        setAcknowledged(checked === true)
                                    }
                                    className="data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600 data-[state=checked]:text-white dark:data-[state=checked]:border-blue-700 dark:data-[state=checked]:bg-blue-700"
                                />
                                <div className="grid gap-1.5 font-normal">
                                    <p className="text-sm font-medium leading-none">
                                        Do not lose this!
                                    </p>
                                    <p className="text-muted-foreground text-sm">
                                        I understand that if I lose my private
                                        key, I may permanently lose access to my{" "}
                                        {networkName} account.
                                    </p>
                                </div>
                            </Label>
                        </div>
                    </CardContent>
                    <CardFooter className="flex flex-1 justify-end">
                        <CardAction>
                            <Button
                                type="button"
                                onClick={() => setStep("3_CONFIRM")}
                                disabled={!acknowledged}
                            >
                                Continue
                            </Button>
                        </CardAction>
                    </CardFooter>
                </>
            )}

            {step === "3_CONFIRM" && (
                <importForm.AppForm>
                    <form
                        id="import-account-form"
                        onSubmit={(e) => {
                            e.preventDefault();
                            importForm.handleSubmit();
                        }}
                        className="flex flex-col gap-6"
                    >
                        <CardContent className="flex flex-col">
                            <div className="mb-6 flex-1 space-y-2">
                                <CardTitle className="text-3xl font-normal">
                                    Sign in
                                </CardTitle>
                                <CardDescription>
                                    Use your {networkName} account
                                </CardDescription>
                            </div>
                            <div className="flex flex-1 flex-col gap-4">
                                <importForm.Subscribe
                                    selector={(state) => [state.isSubmitting]}
                                >
                                    {([isSubmitting]) => (
                                        <FieldAccountExisting
                                            form={importForm}
                                            fields="account"
                                            label="Account name"
                                            description={undefined}
                                            placeholder="Account name"
                                            disabled={isSubmitting}
                                            onValidate={undefined}
                                        />
                                    )}
                                </importForm.Subscribe>
                                <importForm.AppField
                                    name="privateKey"
                                    children={(field) => {
                                        return (
                                            <field.TextField
                                                type="password"
                                                label="Private key"
                                                placeholder="Private key"
                                            />
                                        );
                                    }}
                                />
                            </div>
                        </CardContent>
                        <CardFooter className="mt-4 flex flex-1 justify-between">
                            <CardAction>
                                <Button
                                    type="button"
                                    variant="link"
                                    onClick={() => setStep("2_SAVE")}
                                    className="-ml-4"
                                >
                                    Back
                                </Button>
                            </CardAction>
                            <CardAction>
                                <importForm.SubmitButton
                                    labels={["Confirm", "Confirming..."]}
                                />
                            </CardAction>
                        </CardFooter>
                    </form>
                </importForm.AppForm>
            )}
        </BrandedGlowingCard>
    );
};
