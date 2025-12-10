import { useStore } from "@tanstack/react-form";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { prompt } from "@psibase/common-lib";

import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import { useBranding } from "@shared/hooks/use-branding";
import { zAccount } from "@shared/lib/schemas/account";
import { Button } from "@shared/shadcn/ui/button";
import {
    CardAction,
    CardContent,
    CardDescription,
    CardFooter,
    CardTitle,
} from "@shared/shadcn/ui/card";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { BrandedGlowingCard } from "./components/branded-glowing-card";
import { useCanCreateAccount } from "./hooks/use-can-create-account";
import { useConnectAccount } from "./hooks/use-connect-account";
import { useImportExisting } from "./hooks/use-import-existing";
import { b64ToPem, validateB64 } from "./lib/keys";

export const ImportPrompt = () => {
    const navigate = useNavigate();

    const [authService, setAuthService] = useState<string>("auth-sig");

    // modal state
    const [showCannotCreate, setShowCannotCreate] = useState(false);

    // queries
    const { data: networkName } = useBranding();
    const { data: canCreate = false, isPending: isPendingCanCreate } =
        useCanCreateAccount();

    // mutations
    const importExistingMutation = useImportExisting(); // this will take a private key and it will validate it belongs to the account
    const connectAccountMutation = useConnectAccount();

    const handleImportAndLogin = async (account: string, b64: string) => {
        const pemFormatted = b64ToPem(b64);

        try {
            await importExistingMutation.mutateAsync({
                account: account,
                key: pemFormatted,
            });
            await connectAccountMutation.mutateAsync(account);
            prompt.finished();
        } catch {
            console.error("Import and login failed");
            form.fieldInfo.privateKey.instance?.setErrorMap({
                onSubmit:
                    "Error signing in. Check your private key and try again.",
            });
        }
    };

    const form = useAppForm({
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
                    account: zAccount,
                }),
                privateKey: z.string().refine(
                    (val) => {
                        if (authService !== "auth-sig") return true;
                        return validateB64(val);
                    },
                    {
                        message:
                            authService === "auth-sig"
                                ? "Private key must be a valid base64 string"
                                : "Invalid private key",
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

    const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

    return (
        <>
            <form.AppForm>
                <form
                    id="import-account-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        form.handleSubmit();
                    }}
                >
                    <BrandedGlowingCard>
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
                                <FieldAccountExisting
                                    form={form}
                                    fields="account"
                                    label="Account name"
                                    description={undefined}
                                    placeholder="Account name"
                                    disabled={isSubmitting}
                                    onValidate={(account) => {
                                        const authService =
                                            account?.authService;
                                        if (!authService) return;

                                        setAuthService(authService); // so that we know whether to render the private key field

                                        if (authService === "auth-any") {
                                            // clear any validation errors on the hidden private key field so that the form can be submitted
                                            form.validateField(
                                                "privateKey",
                                                "change",
                                            );
                                        }
                                    }}
                                />
                                {authService === "auth-sig" && (
                                    <form.AppField
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
                                )}
                            </div>
                        </CardContent>
                        <CardFooter className="mt-4 flex flex-1 justify-between">
                            <CardAction>
                                {isPendingCanCreate ? (
                                    <Skeleton className="h-5 w-28" />
                                ) : (
                                    <Button
                                        type="button"
                                        variant="link"
                                        onClick={async () => {
                                            if (canCreate) {
                                                navigate(
                                                    "/plugin/web/prompt/create",
                                                );
                                            } else {
                                                setShowCannotCreate(true);
                                            }
                                        }}
                                        disabled={isSubmitting}
                                        className="px-0 focus-visible:underline focus-visible:underline-offset-4 focus-visible:ring-0"
                                    >
                                        Create account
                                    </Button>
                                )}
                            </CardAction>
                            <CardAction>
                                <form.SubmitButton
                                    labels={["Import", "Importing..."]}
                                />
                            </CardAction>
                        </CardFooter>
                    </BrandedGlowingCard>
                </form>
            </form.AppForm>

            <Dialog
                open={showCannotCreate}
                onOpenChange={(open) => !open && setShowCannotCreate(false)}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Cannot create account</DialogTitle>
                    </DialogHeader>
                    <DialogDescription>
                        To create an account, you must either be logged in as an
                        existing account or have an active invite.
                    </DialogDescription>
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button>Okay</Button>
                        </DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};
