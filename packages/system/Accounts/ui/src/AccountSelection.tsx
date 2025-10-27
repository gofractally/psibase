import { useStore } from "@tanstack/react-form";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";

import { isGenericError } from "@psibase/common-lib";

import { useAcceptInvite } from "@/hooks/useAcceptInvite";
import { fetchAccountStatus, useAccountStatus } from "@/hooks/useAccountStatus";
import { useDecodeConnectionToken } from "@/hooks/useDecodeConnectionToken";
import { useDecodeInviteToken } from "@/hooks/useDecodeInviteToken";
import { useDecodeToken } from "@/hooks/useDecodeToken";
import { useGetAllAccounts } from "@/hooks/useGetAllAccounts";
import { useLoginDirect } from "@/hooks/useLoginDirect";

import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

import { AccountAvailabilityStatus } from "./AccountAvailabilityStatus";
import { AccountsList } from "./AccountsList";
import { ActiveSearch } from "./ActiveSearch";
import { LoadingCard } from "./LoadingCard";
import {
    InviteAlreadyAcceptedCard,
    InviteExpiredCard,
    InviteRejectedCard,
} from "./TokenErrorUIs";
import { useAppForm } from "./components/forms/app-form";
import { useLogout } from "./hooks/use-logout";
import { useCreateAccount } from "./hooks/useCreateAccount";
import { useImportAccount } from "./hooks/useImportAccount";
import { useRejectInvite } from "./hooks/useRejectInvite";
import { zAccount } from "./lib/zod/Account";

dayjs.extend(relativeTime);

const capitaliseFirstLetter = (str: string) =>
    str[0].toUpperCase() + str.slice(1);

export const AccountSelection = () => {
    const [searchParams] = useSearchParams();

    const token = searchParams.get("token");

    if (!token) {
        throw new Error("No token was found in the URL");
    }

    const form = useAppForm({
        defaultValues: {
            username: "",
        },
        validators: {
            onSubmitAsync: async ({ value: { username } }) => {
                try {
                    const app = inviteToken
                        ? inviteToken.app
                        : connectionToken!.app;
                    if (isCreatingAccount) {
                        if (!inviteToken) {
                            throw new Error(`Expected invite token loaded`);
                        }
                        // createAccount handles logout, acceptWithNewAccount, and importAccount
                        await createAccount(username);
                        void (await acceptInvite({
                            app,
                            accountName: username,
                            token: z.string().parse(token),
                        }));
                        window.location.href = inviteToken?.appDomain;
                    } else {
                        // Import existing account
                        await importAccount(username);
                        if (!connectionToken) {
                            throw new Error("Invalid connectionToken");
                        }
                        // Login and set auth cookie
                        await handleLogin(username, app);
                    }
                } catch (error) {
                    console.error("❌ Error in logging in:", error);
                    await logout();
                    return {
                        fields: {
                            username: isGenericError(error)
                                ? error.message
                                : "Unknown error, see console.",
                        },
                    };
                }
            },
        },
        onSubmit: async () => {
            setIsModalOpen(false);
        },
    });

    const [isModalOpen, setIsModalOpen] = useState(false);

    const [isCreatingAccount, setIsCreatingAccount] = useState(true);

    const [fieldMeta, username] = useStore(form.store, (store) => [
        store.fieldMeta.username,
        store.values.username,
    ]);

    const validatedUsername =
        fieldMeta && !fieldMeta.isValidating ? username : undefined;

    const { data: status } = useAccountStatus(validatedUsername);


    const { data: accountsData, isLoading: isFetching } = useGetAllAccounts();
    const accounts = accountsData || [];

    const { mutateAsync: importAccount } = useImportAccount();

    const isNoAccounts = accounts.length == 0;

    const isAccountsLoading = isFetching && !accounts;
    const [selectedAccountId, setSelectedAccountId] = useState<string>("");

    const [activeSearch, setActiveSearch] = useState("");
    const accountsToRender = activeSearch
        ? accounts.filter((account: { account: string }) =>
            account.account
                .toLowerCase()
                .includes(activeSearch.toLowerCase()),
        )
        : accounts;

    const selectedAccount = (accountsToRender || []).find(
        (account) => account.id == selectedAccountId,
    );

    const { data: decodedToken, isLoading: isLoadingToken } =
        useDecodeToken(token);
    const isInviteToken = decodedToken?.tag === "invite-token";

    const onAccountSelection = async (accountId: string) => {
        setSelectedAccountId(accountId);
        if (!isInviteToken) {
            if (!connectionToken) {
                throw new Error(`Expected connection token`);
            }

            try {
                void (await handleLogin(accountId, connectionToken.app));
            } catch (error) {
                console.error("❌ Error logging in:", error);
                await logout();
                return;
            }
        }
    };

    const { data: inviteToken, isLoading: isLoadingInvite } =
        useDecodeInviteToken(token, decodedToken?.tag == "invite-token");

    const { data: connectionToken, isLoading: isLoadingConnectionToken } =
        useDecodeConnectionToken(
            token,
            decodedToken?.tag == "connection-token",
        );

    const isInitialLoading =
        isLoadingInvite || isLoadingConnectionToken || isLoadingToken;

    const { mutateAsync: createAccount, isSuccess: isInviteClaimed } =
        useCreateAccount(token);

    const appName = isInviteToken
        ? inviteToken
            ? capitaliseFirstLetter(inviteToken.app)
            : ""
        : connectionToken
            ? capitaliseFirstLetter(connectionToken.app)
            : "";

    const isExpired = inviteToken
        ? inviteToken.expiry.valueOf() < new Date().valueOf()
        : false;

    const { mutateAsync: rejectInvite, isPending: isRejecting } =
        useRejectInvite(selectedAccount?.account || "", token);

    const { mutateAsync: loginDirect, isPending: isLoggingIn } =
        useLoginDirect();
    const { mutateAsync: logout } = useLogout();

    const handleLogin = async (accountName: string, app: string) => {
        if (!connectionToken) {
            throw new Error(`Expected connection token for a login`);
        }
        await loginDirect({
            accountName,
            app,
        });
    };

    const { mutateAsync: acceptInvite, isPending: isAccepting } =
        useAcceptInvite();

    const isTxInProgress = isRejecting || isAccepting || isLoggingIn;

    if (isLoadingInvite) {
        return <LoadingCard />;
    }

    if (inviteToken?.state == "accepted" && !isInviteClaimed) {
        return <InviteAlreadyAcceptedCard token={token} />;
    }

    if (inviteToken?.state == "rejected") {
        return <InviteRejectedCard token={token} />;
    }

    if (isExpired) {
        return <InviteExpiredCard token={token} />;
    }

    const onAcceptOrLogin = async () => {
        if (isInviteToken) {
            if (!inviteToken) {
                throw new Error(`Expected invite token loaded`);
            }
            await acceptInvite({
                token: z.string().parse(token),
                accountName: z.string().parse(selectedAccount?.account),
                app: inviteToken.app,
            });
            window.location.href = inviteToken?.appDomain;
        } else {
            // This is dead code; now handled by the click event on an account
            // Login
            if (!connectionToken) {
                throw new Error(`Expected connection token for a login`);
            }
            loginDirect({
                app: connectionToken.app,
                accountName: selectedAccount!.account,
            });
        }
    };

    return (
        <>
            <Dialog
                open={isModalOpen}
                onOpenChange={(open: boolean) => setIsModalOpen(open)}
            >
                <div className="mt-6">
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>
                                {isCreatingAccount
                                    ? "Create an account"
                                    : "Import an account"}
                            </DialogTitle>
                            <DialogDescription>
                                {isCreatingAccount
                                    ? `Use this invitation to create an on-chain account and use it to
                connect to the ${appName} app.`
                                    : "Import a pre-existing account prior to accepting / denying an invite."}
                            </DialogDescription>
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    form.handleSubmit();
                                }}
                                className="mt-2 w-full space-y-6"
                            >
                                <form.AppField
                                    name="username"
                                    asyncDebounceMs={1000}
                                    validators={{
                                        onChange: zAccount,
                                        onChangeAsync: async (field) => {
                                            const remoteStatus =
                                                await fetchAccountStatus(
                                                    field.value,
                                                );

                                            if (remoteStatus == "Invalid")
                                                return "Invalid account";
                                            if (
                                                isInviteToken &&
                                                remoteStatus == "Taken"
                                            ) {
                                                return "Account is taken";
                                            } else if (
                                                !isInviteToken &&
                                                remoteStatus == "Available"
                                            ) {
                                                return "Account not does exist";
                                            }
                                        },
                                    }}
                                    children={(field) => (
                                        <field.TextField
                                            label="Username"
                                            rightLabel={
                                                <AccountAvailabilityStatus
                                                    accountStatus={status}
                                                    isLoading={
                                                        fieldMeta &&
                                                        fieldMeta.isValidating
                                                    }
                                                    isCreatingAccount={
                                                        isCreatingAccount
                                                    }
                                                />
                                            }
                                        />
                                    )}
                                />

                                <form.AppForm>
                                    <form.SubmitButton
                                        labels={["Accept", "Accepting"]}
                                    />
                                </form.AppForm>
                            </form>
                        </DialogHeader>
                    </DialogContent>
                    <div className="mx-auto max-w-lg">
                        <div className="text-muted-foreground py-2 text-center">
                            <div>
                                {isInitialLoading
                                    ? "Loading..."
                                    : isInviteToken
                                        ? `Select an account to accept invite to `
                                        : `Select an account to login to  `}
                            </div>
                        </div>
                        <ActiveSearch
                            isNoAccounts={isNoAccounts}
                            activeSearch={activeSearch}
                            setActiveSearch={setActiveSearch}
                        />
                        <div className="flex flex-col gap-3 ">
                            <AccountsList
                                isAccountsLoading={isAccountsLoading}
                                accountsToRender={accountsToRender}
                                selectedAccountId={selectedAccountId}
                                onAccountSelection={onAccountSelection}
                            />
                            {isInviteToken && !isInviteClaimed && (
                                <button
                                    onClick={() => {
                                        setIsCreatingAccount(true);
                                        setIsModalOpen(true);
                                    }}
                                    className="text-muted-foreground hover:text-primary flex shrink-0 items-center justify-center rounded-md border border-dashed border-neutral-600 p-4 hover:underline"
                                >
                                    Create a new account
                                </button>
                            )}
                        </div>
                        {!isNoAccounts && (
                            <div className="my-3">
                                <Button
                                    disabled={
                                        !selectedAccount || isTxInProgress
                                    }
                                    onClick={onAcceptOrLogin}
                                    className="w-full"
                                >
                                    {form.state.isSubmitting
                                        ? "Loading..."
                                        : isInviteToken
                                            ? "Accept invite"
                                            : "Login"}
                                </Button>
                            </div>
                        )}
                        <div className="flex w-full justify-center">
                            {isInviteToken && (
                                <Button
                                    onClick={() => rejectInvite()}
                                    variant="link"
                                    className="text-muted-foreground"
                                >
                                    Reject invite
                                </Button>
                            )}
                        </div>
                        {!isInviteToken && (
                            <div className="flex w-full justify-center">
                                <Button
                                    onClick={() => {
                                        setIsCreatingAccount(false);
                                        setIsModalOpen(true);
                                    }}
                                    variant={isNoAccounts ? "default" : "link"}
                                    className={cn({
                                        "text-muted-foreground": !isNoAccounts,
                                    })}
                                >
                                    Import an account
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </Dialog>
        </>
    );
};
