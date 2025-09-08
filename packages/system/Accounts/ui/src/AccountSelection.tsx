import { zodResolver } from "@hookform/resolvers/zod";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import debounce from "debounce";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";

import { useAcceptInvite } from "@/hooks/useAcceptInvite";
import { useAccountStatus } from "@/hooks/useAccountStatus";
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
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@shared/shadcn/ui/form";
import { Input } from "@shared/shadcn/ui/input";

import { AccountAvailabilityStatus } from "./AccountAvailabilityStatus";
import { AccountsList } from "./AccountsList";
import { ActiveSearch } from "./ActiveSearch";
import { LoadingCard } from "./LoadingCard";
import {
    InviteAlreadyAcceptedCard,
    InviteExpiredCard,
    InviteRejectedCard,
} from "./TokenErrorUIs";
import { useLogout } from "./hooks/use-logout";
import { useCreateAccount } from "./hooks/useCreateAccount";
import { useImportAccount } from "./hooks/useImportAccount";
import { useRejectInvite } from "./hooks/useRejectInvite";

dayjs.extend(relativeTime);

const capitaliseFirstLetter = (str: string) =>
    str[0].toUpperCase() + str.slice(1);

const formSchema = z.object({
    username: z.string().min(1).max(50),
});

export const AccountSelection = () => {
    const [searchParams] = useSearchParams();

    const token = searchParams.get("token");

    if (!token) {
        throw new Error("No token was found in the URL");
    }

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            username: "",
        },
    });

    const [isModalOpen, setIsModalOpen] = useState(false);

    const [isCreatingAccount, setIsCreatingAccount] = useState(true);

    const { isDirty, isSubmitting } = form.formState;

    const onSubmit = async (values: z.infer<typeof formSchema>) => {
        try {
            const app = inviteToken ? inviteToken.app : connectionToken!.app;
            if (isCreatingAccount) {
                if (!inviteToken) {
                    throw new Error(`Expected invite token loaded`);
                }
                // createAccount handles logout, acceptWithNewAccount, and importAccount
                await createAccount(values.username);
                console.log("Account UI.onSubmit().1");
                void (await acceptInvite({
                    app,
                    accountName: values.username,
                    token: z.string().parse(token),
                }));
                console.log("Account UI.onSubmit().2; redirecting to app...");
                window.location.href = inviteToken?.appDomain;
            } else {
                // Import existing account
                await importAccount(values.username);
                if (!connectionToken) {
                    throw new Error("Invalid connectionToken");
                }
                // Login and set auth cookie
                await handleLogin(values.username, app);
            }
        } catch (error) {
            console.error("❌ Error in logging in:", error);
            await logout();
            return;
        }
        console.log("Accounts UI.closing modal...");
        setIsModalOpen(false);
    };

    const username = form.watch("username");

    const [debouncedAccount, setDebouncedAccount] = useState<string>();

    const { data: accounts, isLoading: isFetching } = useGetAllAccounts();

    const { mutateAsync: importAccount } = useImportAccount();

    const isNoAccounts = accounts ? accounts.length == 0 : false;

    const { data: status, isLoading: debounceIsLoading } =
        useAccountStatus(debouncedAccount);

    const isProcessing = debounceIsLoading || username !== debouncedAccount;

    const accountStatus = isProcessing ? "Loading" : status;

    const isAccountsLoading = isFetching && !accounts;
    const [selectedAccountId, setSelectedAccountId] = useState<string>("");

    useEffect(() => {
        const debouncedCb = debounce((formValue) => {
            setDebouncedAccount(formValue.username);
        }, 1000);

        const subscription = form.watch(debouncedCb);

        return () => subscription.unsubscribe();
    }, [form]);

    const [activeSearch, setActiveSearch] = useState("");
    const accountsToRender = activeSearch
        ? (accounts || []).filter((account: { account: string }) =>
              account.account
                  .toLowerCase()
                  .includes(activeSearch.toLowerCase()),
          )
        : accounts || [];

    const selectedAccount = (accountsToRender || []).find(
        (account) => account.id == selectedAccountId,
    );

    const { data: decodedToken, isLoading: isLoadingToken } =
        useDecodeToken(token);
    const isInvite = decodedToken?.tag === "invite-token";

    const disableModalSubmit: boolean =
        accountStatus !== (isInvite ? "Available" : "Taken");

    const onAccountSelection = async (accountId: string) => {
        setSelectedAccountId(accountId);
        if (!isInvite) {
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

    const appName = isInvite
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
        if (isInvite) {
            if (!inviteToken) {
                throw new Error(`Expected invite token loaded`);
            }
            console.log("Account UI.onAcceptOrLogin().1");
            await acceptInvite({
                token: z.string().parse(token),
                accountName: z.string().parse(selectedAccount?.account),
                app: inviteToken.app,
            });
            console.log("Account UI.onAcceptOrLogin().2");
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
                            <Form {...form}>
                                <form
                                    onSubmit={form.handleSubmit(onSubmit)}
                                    className="mt-2 w-full space-y-6"
                                >
                                    <FormField
                                        control={form.control}
                                        name="username"
                                        render={({ field }) => (
                                            <FormItem>
                                                <div className="flex w-full justify-between ">
                                                    <FormLabel>
                                                        Username
                                                    </FormLabel>
                                                    {isDirty && (
                                                        <AccountAvailabilityStatus
                                                            accountStatus={
                                                                accountStatus
                                                            }
                                                            isCreatingAccount={
                                                                isCreatingAccount
                                                            }
                                                        />
                                                    )}
                                                </div>
                                                <FormControl>
                                                    <Input {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <Button
                                        type="submit"
                                        disabled={disableModalSubmit}
                                    >
                                        {isCreatingAccount
                                            ? `${isSubmitting ? "Accepting" : "Accept"} invite`
                                            : `Import account`}
                                    </Button>
                                </form>
                            </Form>
                        </DialogHeader>
                    </DialogContent>
                    <div className="mx-auto max-w-lg">
                        <div className="text-muted-foreground py-2 text-center">
                            <div>
                                {isInitialLoading
                                    ? "Loading..."
                                    : isInvite
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
                            {isInvite && !isInviteClaimed && (
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
                                    {isSubmitting
                                        ? "Loading..."
                                        : isInvite
                                          ? "Accept invite"
                                          : "Login"}
                                </Button>
                            </div>
                        )}
                        <div className="flex w-full justify-center">
                            {isInvite && (
                                <Button
                                    onClick={() => rejectInvite()}
                                    variant="link"
                                    className="text-muted-foreground"
                                >
                                    Reject invite
                                </Button>
                            )}
                        </div>
                        {!isInvite && (
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
