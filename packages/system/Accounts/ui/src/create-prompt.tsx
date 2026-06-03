import { useStore } from "@tanstack/react-form";
import { useCallback, useMemo, useRef, useState } from "react";
import { z } from "zod";

import { prompt } from "@psibase/common-lib";

import { BrandedGlowingCard } from "@shared/components/branded-glowing-card";
import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import { useBranding } from "@shared/hooks/use-branding";
import { useCanCreatePremiumAccount } from "@shared/hooks/use-can-create-premium-account";
import {
    PREM_MARKETS_REFETCH_INTERVAL_MS,
    usePremMarkets,
} from "@shared/hooks/use-prem-markets";
import { useSystemToken } from "@shared/hooks/use-system-token";
import { b64ToPem, pemToB64, validateB64 } from "@shared/lib/b64-key-utils";
import { getAccount } from "@shared/lib/get-account";
import { Quantity } from "@shared/lib/quantity";
import { premMarketPricesFromOverview } from "@shared/lib/schemas/prem-accounts";
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

import { BuyNameConfirmationDialog } from "@shared/components/premium-accounts/buy-name-confirmation-dialog";

import { CopyButton } from "./components/copy-button";
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
    const [confirmPrice, setConfirmPrice] = useState<Quantity | null>(null);
    const [isAccountTaken, setIsAccountTaken] = useState<boolean | null>(null);

    const { data: networkName } = useBranding();
    const { data: systemToken, isPending: isPendingSystemToken } =
        useSystemToken();

    const {
        data: canCreatePremiumAccount,
        isPending: isPendingCanCreatePremiumAccount,
    } = useCanCreatePremiumAccount();

    const { data: markets, isPending: isPendingMarkets } = usePremMarkets({
        enabled: Boolean(canCreatePremiumAccount),
        refetchInterval: canCreatePremiumAccount
            ? PREM_MARKETS_REFETCH_INTERVAL_MS
            : false,
    });

    const prices = useMemo(
        () =>
            markets ? premMarketPricesFromOverview(markets) : new Map<number, string>(),
        [markets],
    );

    const pricesRef = useRef(prices);
    pricesRef.current = prices;
    const isAccountTakenRef = useRef(isAccountTaken);
    isAccountTakenRef.current = isAccountTaken;

    const resolveLivePrice = useCallback(
        (rawAccountName: string): Quantity | null => {
            if (!canCreatePremiumAccount || !systemToken) {
                return null;
            }
            const parsed = zAccount.safeParse(rawAccountName.trim());
            if (
                !parsed.success ||
                isAccountTakenRef.current !== false ||
                parsed.data.length >= MIN_FREE_ACCOUNT_NAME_LENGTH
            ) {
                return null;
            }
            const canonical = pricesRef.current.get(parsed.data.length);
            if (!canonical) {
                return null;
            }
            return new Quantity(
                canonical,
                systemToken.precision,
                Number(systemToken.id),
                systemToken.symbol,
            );
        },
        [canCreatePremiumAccount, systemToken],
    );

    const isLoading =
        isPendingSystemToken ||
        isPendingCanCreatePremiumAccount ||
        (canCreatePremiumAccount && isPendingMarkets);

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
                const taken = Boolean(account?.accountNum);
                setIsAccountTaken(taken);
                isAccountTakenRef.current = taken;

                const priceAtSubmit = taken
                    ? null
                    : resolveLivePrice(value.account);

                return {
                    fields: {
                        account: taken
                            ? "This account name is not available"
                            : canCreatePremiumAccount &&
                                zAccount.safeParse(value.account.trim()).success &&
                                value.account.trim().length <
                                    MIN_FREE_ACCOUNT_NAME_LENGTH &&
                                !priceAtSubmit
                              ? "Market price is not available for this name."
                              : undefined,
                    },
                };
            },
        },
        onSubmit: async (data) => {
            const priceAtSubmit = resolveLivePrice(data.value.account);
            if (priceAtSubmit) {
                setConfirmPrice(priceAtSubmit);
                setBuyConfirmOpen(true);
                return;
            }
            await handleCreateOrBuy(data.value.account);
        },
    });

    const handleCreateOrBuy = async (account: string) => {
        const name = account.trim();
        if (!name) return;
        const purchasePrice = confirmPrice;
        try {
            let privateKey: string;
            if (purchasePrice) {
                privateKey = await purchaseAccountMutation.mutateAsync([
                    name,
                    purchasePrice
                        .multiply(1 + DEFAULT_NAME_PURCHASE_SLIPPAGE / 100)
                        .format({
                            includeLabel: false,
                            fullPrecision: true,
                            showThousandsSeparator: false,
                        }),
                ]);
            } else {
                privateKey = await createAccountMutation.mutateAsync(name);
            }
            setKey(pemToB64(privateKey));
            setBuyConfirmOpen(false);
            setConfirmPrice(null);
            setStep("2_SAVE");
        } catch (error) {
            setBuyConfirmOpen(false);
            setConfirmPrice(null);
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

    const livePrice = useMemo(
        () => resolveLivePrice(createdAccount),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- prices, isAccountTaken
        [createdAccount, prices, isAccountTaken, resolveLivePrice],
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
            const message =
                "Error signing in. Check your private key and try again.";
            importForm.setFieldMeta("privateKey", (prev) => ({
                ...prev,
                isTouched: true,
                errors: [message],
                errorMap: { onSubmit: message },
            }));
        }
    };

    if (isLoading) {
        return <Loader />;
    }

    const validateAccountOnChange = ({
        value: rawValue,
    }: {
        value: string;
    }) => {
        if (!canCreatePremiumAccount) {
            return;
        }
        try {
            setIsAccountTaken(null);
            const value = zAccount.parse(rawValue);
            if (value.length >= MIN_FREE_ACCOUNT_NAME_LENGTH) {
                return;
            }
            if (!pricesRef.current.has(value.length)) {
                return `${value.length} character account names are not available`;
            }
        } catch (e) {
            if (e instanceof z.ZodError) return;
            if (typeof e === "string") return e;
            console.error("Failed to validate account name:", e);
        }
    };

    const validateAccountOnChangeAsync = async ({
        value: rawValue,
    }: {
        value: string;
    }) => {
        try {
            const value = accountValidator.parse(rawValue);

            const account = await getAccount(value);
            const taken = Boolean(account?.accountNum);
            setIsAccountTaken(taken);
            isAccountTakenRef.current = taken;
            if (taken) return "Account name is already taken";

            if (
                canCreatePremiumAccount &&
                value.length < MIN_FREE_ACCOUNT_NAME_LENGTH
            ) {
                if (!pricesRef.current.has(value.length)) {
                    return `${value.length} character account names are not available`;
                }
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
                ) : livePrice ? (
                    <Label className="text-green-500">
                        Available for {livePrice.format({ includeLabel: true })}
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
                            void createForm.handleSubmit();
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
                                    onChange: validateAccountOnChange,
                                    onChangeAsync: validateAccountOnChangeAsync,
                                }}
                            />
                        </CardContent>
                        <CardFooter className="flex flex-1 justify-end">
                            <CardAction>
                                <createForm.SubmitButton
                                    labels={
                                        livePrice
                                            ? ["Buy now", "Buying..."]
                                            : ["Create", "Creating..."]
                                    }
                                    disabled={
                                        livePrice
                                            ? purchaseAccountMutation.isPending
                                            : false
                                    }
                                />
                            </CardAction>
                        </CardFooter>
                    </form>
                    {confirmPrice ? (
                        <BuyNameConfirmationDialog
                            open={buyConfirmOpen}
                            setOpen={(open) => {
                                setBuyConfirmOpen(open);
                                if (!open) {
                                    setConfirmPrice(null);
                                }
                            }}
                            mode="buy-and-claim"
                            account={createdAccount}
                            price={confirmPrice}
                            slippage={DEFAULT_NAME_PURCHASE_SLIPPAGE}
                            isLoading={purchaseAccountMutation.isPending}
                            onConfirm={() => void handleCreateOrBuy(createdAccount)}
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
