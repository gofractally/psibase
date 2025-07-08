import { zodResolver } from "@hookform/resolvers/zod";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import debounce from "debounce";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
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
    const token: string = z.string().parse(searchParams.get("token"));

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            username: "",
        },
    });

    const key = searchParams.get("key");

    const navigate = useNavigate();

    // Auto nav if the key param is present,
    if (key) {
        navigate(`/key?key=${key}`);
    }

    const [isModalOpen, setIsModalOpen] = useState(false);

    const [isCreatingAccount, setIsCreatingAccount] = useState(true);

    const { isDirty, isSubmitting } = form.formState;

    const onSubmit = async (values: z.infer<typeof formSchema>) => {
        if (isCreatingAccount) {
            void (await createAccount(values.username));
            void (await acceptInvite({
                origin: inviteToken
                    ? inviteToken.appDomain
                    : connectionToken!.origin,
                app: inviteToken ? inviteToken.app : connectionToken!.app,
                accountName: values.username,
                token: z.string().parse(token),
            }));
        } else {
            void (await importAccount(values.username));
            void (await login({
                accountName: values.username,
                app: connectionToken!.app,
                origin: connectionToken!.origin,
            }));
        }
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
        ? (accounts || []).filter((account) =>
              account.account
                  .toLowerCase()
                  .includes(activeSearch.toLowerCase()),
          )
        : accounts || [];
    // const [accountsToRender, setAccountsToRender]: [
    //   AccountType[],
    //   (accounts: AccountType[]) => void,
    // ] = useState<AccountType[]>([]);

    // useEffect(() => {
    //   setAccountsToRender(accounts || []);
    // }, [accounts]);

    const selectedAccount = (accountsToRender || []).find(
        (account) => account.id == selectedAccountId,
    );

    const { data: decodedToken, isLoading: isLoadingToken } =
        useDecodeToken(token);
    const isInvite = decodedToken?.tag === "invite-token";

    const disableModalSubmit: boolean =
        accountStatus !== (isInvite ? "Available" : "Taken");

    const onAccountSelection = (accountId: string) => {
        setSelectedAccountId(accountId);
        if (!isInvite) {
            if (!connectionToken) {
                throw new Error(`Expected connection token`);
            }
            login({
                accountName: accountId,
                app: connectionToken.app,
                origin: connectionToken.origin,
            });
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

    const { mutateAsync: login, isPending: isLoggingIn } = useLoginDirect();

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

    const onAcceptOrLogin = () => {
        if (isInvite) {
            if (!inviteToken) {
                throw new Error(`Expected invite token loaded`);
            }
            acceptInvite({
                token: z.string().parse(token),
                accountName: z.string().parse(selectedAccount?.account),
                app: inviteToken.app,
                origin: inviteToken.appDomain,
            });
        } else {
            if (!connectionToken) {
                throw new Error(`Expected connection token for a login`);
            }
            login({
                app: connectionToken.app,
                origin: connectionToken.origin,
                accountName: selectedAccount!.account,
            });
        }
    };

    return (
        <>
            <Dialog
                open={isModalOpen}
                onOpenChange={(open) => setIsModalOpen(open)}
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
