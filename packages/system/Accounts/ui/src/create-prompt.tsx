import { z } from "zod";

import { prompt } from "@psibase/common-lib";

import { useAppForm } from "@shared/components/form/app-form";
import { useBranding } from "@shared/hooks/use-branding";
import { getAccount } from "@shared/lib/get-account";
import { zAccount } from "@shared/lib/schemas/account";
import {
    CardAction,
    CardContent,
    CardFooter,
    CardTitle,
} from "@shared/shadcn/ui/card";

import { BrandedGlowingCard } from "./components/branded-glowing-card";
import { useConnectAccount } from "./hooks/use-connect-account";
import { useCreateAccount } from "./hooks/use-create-account";
import { useImportExisting } from "./hooks/use-import-existing";

export const CreatePrompt = () => {
    const { data: networkName } = useBranding();

    const importExistingMutation = useImportExisting();
    const createAccountMutation = useCreateAccount();
    const connectAccountMutation = useConnectAccount();

    const handleCreate = async (account: string) => {
        const name = account.trim();
        if (!name) return;
        try {
            const privateKey = await createAccountMutation.mutateAsync(name);
            console.log("privateKey", privateKey);
        } catch {
            console.error("Create account failed");
        }
    };

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
                            <div className="text-muted-foreground">
                                Valid account names are 10-18 characters long,
                                must start with a letter, and can only contain
                                letters, numbers, and underscores
                            </div>
                        </div>
                        <div className="flex-1">
                            <form.AppField
                                name="account"
                                children={(field) => (
                                    <field.TextField
                                        label="Account name"
                                        placeholder="Account name"
                                    />
                                )}
                            />
                        </div>
                    </CardContent>
                    <CardFooter className="flex flex-1 justify-end">
                        <CardAction>
                            <form.SubmitButton
                                labels={["Import", "Importing..."]}
                            />
                        </CardAction>
                    </CardFooter>
                </BrandedGlowingCard>
            </form>
        </form.AppForm>
    );
};
