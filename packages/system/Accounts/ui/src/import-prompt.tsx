import { useStore } from "@tanstack/react-form";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { getSupervisor, prompt } from "@psibase/common-lib";

import { useAppForm } from "@shared/components/form/app-form";
import { FieldAccountExisting } from "@shared/components/form/field-account-existing";
import { useBranding } from "@shared/hooks/use-branding";
import { zAccount } from "@shared/lib/schemas/account";
import { Button } from "@shared/shadcn/ui/button";
import {
    CardAction,
    CardContent,
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
import { Input } from "@shared/shadcn/ui/input";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { BrandedGlowingCard } from "./components/branded-glowing-card";
import { useCanCreateAccount } from "./hooks/use-can-create-account";
import { useConnectAccount } from "./hooks/use-connect-account";
import { useCreateAccount } from "./hooks/use-create-account";
import { useGetAllAccounts } from "./hooks/use-get-all-accounts";
import { useImportExisting } from "./hooks/use-import-existing";

const supervisor = getSupervisor();

export const ImportPrompt = () => {
    const navigate = useNavigate();

    // modal state
    const [showCreate, setShowCreate] = useState(false);
    const [showCannotCreate, setShowCannotCreate] = useState(false);

    const [createName, setCreateName] = useState("");

    // queries
    const { data: networkName } = useBranding();
    const { refetch: refetchAccounts } = useGetAllAccounts();
    const { data: canCreate = false, isPending: isPendingCanCreate } =
        useCanCreateAccount();

    // mutations
    const importExistingMutation = useImportExisting();
    const createAccountMutation = useCreateAccount();
    const connectAccountMutation = useConnectAccount();

    const handleCreate = async () => {
        const name = createName.trim();
        if (!name) return;
        try {
            const privateKey = await createAccountMutation.mutateAsync(name);
            console.log("privateKey", privateKey);
            await refetchAccounts();
            setShowCreate(false);
            setCreateName("");
            navigate("/plugin/web/prompt/connect");
        } catch {
            console.error("Create account failed");
        }
    };

    const handleImportAndLogin = async (account: string) => {
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
            account: {
                account: "",
            },
        },
        validators: {
            onChange: z.object({
                account: z.object({
                    account: zAccount.or(z.literal("")),
                }),
            }),
        },
        onSubmit: async (data) => {
            await handleImportAndLogin(data.value.account.account);
        },
    });

    const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

    // if (loading) {
    //     return (
    //         <BrandedGlowingCard>
    //             <CardContent className="flex flex-col">
    //                 <Skeleton className="mb-6 h-8 w-[200px]" />
    //                 <div className="space-y-2">
    //                     <Skeleton className="h-4 w-[250px]" />
    //                     <Skeleton className="h-4 w-[200px]" />
    //                 </div>
    //             </CardContent>
    //         </BrandedGlowingCard>
    //     );
    // }

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
                                <div className="text-muted-foreground">
                                    Use your {networkName} account
                                </div>
                            </div>
                            <div className="flex-1">
                                <FieldAccountExisting
                                    form={form}
                                    fields="account"
                                    label="Account name"
                                    description={undefined}
                                    placeholder="Account name"
                                    disabled={isSubmitting}
                                    supervisor={supervisor}
                                />
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
                                                setShowCreate(true);
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
                open={showCreate}
                onOpenChange={(open) => !open && setShowCreate(false)}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create new account</DialogTitle>
                    </DialogHeader>
                    <div className="flex items-center gap-2">
                        <Input
                            className="text-foreground placeholder:text-muted-foreground flex-1"
                            placeholder="Enter account name"
                            value={createName}
                            onChange={(e) => setCreateName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleCreate();
                            }}
                        />
                        <Button onClick={handleCreate}>Create</Button>
                    </div>
                </DialogContent>
            </Dialog>

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
