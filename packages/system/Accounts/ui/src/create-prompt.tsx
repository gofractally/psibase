import { Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { prompt } from "@psibase/common-lib";

import { useAppForm } from "@shared/components/form/app-form";
import { useBranding } from "@shared/hooks/use-branding";
import { getAccount } from "@shared/lib/get-account";
import { zAccount } from "@shared/lib/schemas/account";
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

import { BrandedGlowingCard } from "./components/branded-glowing-card";
import { useConnectAccount } from "./hooks/use-connect-account";
import { useCreateAccount } from "./hooks/use-create-account";
import { useImportExisting } from "./hooks/use-import-existing";
import { pemToB64 } from "./lib/keys";

export const CreatePrompt = () => {
    const [key, setKey] = useState<string>("");
    const [showPassword, setShowPassword] = useState(false);
    const [acknowledged, setAcknowledged] = useState(false);
    const navigate = useNavigate();

    const { data: networkName } = useBranding();

    const importExistingMutation = useImportExisting();
    const createAccountMutation = useCreateAccount();
    const connectAccountMutation = useConnectAccount();

    const _handleImportAndLogin = async (account: string) => {
        try {
            await importExistingMutation.mutateAsync(account);
            await connectAccountMutation.mutateAsync(account);
            prompt.finished();
        } catch {
            console.error("Import and login failed");
        }
    };

    const form = useAppForm({
        defaultValues: {
            account: "",
        },
        validators: {
            onSubmit: z.object({
                account: zAccount.refine((val) => val.length >= 10, {
                    message: "Account must be at least 10 characters.",
                }),
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
            await handleCreate(data.value.account);
        },
    });

    const handleCreate = async (account: string) => {
        const name = account.trim();
        if (!name) return;
        try {
            const privateKey = await createAccountMutation.mutateAsync(name);
            setKey(pemToB64(privateKey));
        } catch (error) {
            console.error("Create account failed:");
            console.error(
                error instanceof Error ? error.message : "Unknown error",
            );
            if (
                error instanceof Error &&
                error.message.includes("Invalid account name")
            ) {
                form.fieldInfo.account.instance?.setErrorMap({
                    onSubmit: "This account name is not available",
                });
            }
        }
    };

    if (!key) {
        return (
            <form.AppForm>
                <form
                    id="create-account-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        form.handleSubmit();
                    }}
                >
                    <BrandedGlowingCard>
                        <CardContent className="flex flex-col">
                            <div className="mb-6 flex-1 space-y-2">
                                <CardTitle className="text-3xl font-normal">
                                    Create a {networkName} account
                                </CardTitle>
                                <CardDescription>
                                    Valid account names are 10-18 characters
                                    long, must start with a letter, and can only
                                    contain letters, numbers, and underscores.
                                </CardDescription>
                            </div>
                            <form.AppField
                                name="account"
                                children={(field) => (
                                    <field.TextField
                                        label="Account name"
                                        placeholder="Account name"
                                    />
                                )}
                            />
                        </CardContent>
                        <CardFooter className="flex flex-1 justify-end">
                            <CardAction>
                                <form.SubmitButton
                                    labels={["Create", "Creating..."]}
                                />
                            </CardAction>
                        </CardFooter>
                    </BrandedGlowingCard>
                </form>
            </form.AppForm>
        );
    }

    return (
        <BrandedGlowingCard>
            <CardContent className="flex flex-col gap-8">
                <div>
                    <CardTitle className="text-3xl font-normal">
                        Secure your {networkName} account
                    </CardTitle>
                    <CardDescription>
                        Your <span className="font-semibold">Private Key</span>{" "}
                        serves as your account password allowing you to sign
                        into your account from any browser or device.{" "}
                        <span className="font-semibold">
                            Store it safely and securely
                        </span>
                        , as it cannot be recovered if you lose it.
                    </CardDescription>
                </div>
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <Label>Private Key</Label>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Input
                                    type={showPassword ? "text" : "password"}
                                    value={key}
                                    readOnly
                                    className="pr-20"
                                    onFocus={(e) => e.target.select()}
                                />
                                <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-1">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={() =>
                                            setShowPassword(!showPassword)
                                        }
                                        aria-label={
                                            showPassword
                                                ? "Hide password"
                                                : "Show password"
                                        }
                                    >
                                        {showPassword ? (
                                            <EyeOff className="h-4 w-4" />
                                        ) : (
                                            <Eye className="h-4 w-4" />
                                        )}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={async () => {
                                            try {
                                                await navigator.clipboard.writeText(
                                                    key,
                                                );
                                            } catch (err) {
                                                console.error(
                                                    "Failed to copy:",
                                                    err,
                                                );
                                            }
                                        }}
                                        aria-label="Copy private key"
                                    >
                                        <Copy className="h-4 w-4" />
                                    </Button>
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
                                I understand that if I lose my private key, I
                                may permanently lose access to my {networkName}{" "}
                                account.
                            </p>
                        </div>
                    </Label>
                </div>
            </CardContent>
            <CardFooter className="flex flex-1 justify-end">
                <CardAction>
                    <Button
                        type="button"
                        onClick={() => navigate("/plugin/web/prompt/import")}
                        disabled={!acknowledged}
                    >
                        Sign In
                    </Button>
                </CardAction>
            </CardFooter>
        </BrandedGlowingCard>
    );
};
