import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

import { z } from "zod";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Input } from "@/components/ui/input";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import debounce from "debounce";
import { Button } from "./components/ui/button";

import { Check, UserX, LoaderCircle } from "lucide-react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

import { useNavigate, useSearchParams } from "react-router-dom";
import { useDecodeInviteToken } from "@/hooks/useDecodeInviteToken";
import { useDecodeConnectionToken } from "@/hooks/useDecodeConnectionToken";
import { useDecodeToken } from "@/hooks/useDecodeToken";
import { useGetAllAccounts } from "@/hooks/useGetAllAccounts";
import { useLoginDirect } from "@/hooks/useLoginDirect";
import { useAcceptInvite } from "@/hooks/useAcceptInvite";
import { useAccountStatus } from "@/hooks/useAccountStatus";
import { useImportAccount } from "./hooks/useImportAccount";

import { AccountsList } from "./AccountsList";
import { useCreateAccount } from "./hooks/useCreateAccount";
import { useRejectInvite } from "./hooks/useRejectInvite";
import { LoadingCard } from "./LoadingCard";
import {
  InviteAlreadyAcceptedCard,
  InviteRejectedCard,
  InviteExpiredCard,
} from "./TokenErrorUIs";
import { ActiveSearch } from "./ActiveSearch";

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
        origin: inviteToken ? inviteToken.appDomain : connectionToken!.origin,
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
  const [selectedAccountId, setSelectedAccountId] = useState<string>();

  useEffect(() => {
    const debouncedCb = debounce((formValue) => {
      setDebouncedAccount(formValue.username);
    }, 1000);

    const subscription = form.watch(debouncedCb);

    return () => subscription.unsubscribe();
  }, [form]);

  const [accountsToRender, setAccountsToRender] = useState<any[]>([]);

  const selectedAccount = (accountsToRender || []).find(
    (account) => account.id == selectedAccountId
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
    useDecodeConnectionToken(token, decodedToken?.tag == "connection-token");

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

  const { mutateAsync: rejectInvite, isPending: isRejecting } = useRejectInvite(
    selectedAccount,
    token
  );

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

  return (
    <>
      <Dialog open={isModalOpen} onOpenChange={(open) => setIsModalOpen(open)}>
        <div className="mt-6">
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {isCreatingAccount ? "Create an account" : "Import an account"}
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
                  className="w-full mt-2 space-y-6"
                >
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <div className="w-full flex justify-between ">
                          <FormLabel>Username</FormLabel>
                          {isDirty && isCreatingAccount && (
                            <FormLabel className="text-muted-foreground">
                              {accountStatus === "Available" ? (
                                <div className="flex gap-1">
                                  <div className="text-sm">Available</div>
                                  <Check size={15} className="my-auto" />{" "}
                                </div>
                              ) : accountStatus === "Taken" ? (
                                <div className="flex gap-1">
                                  {" "}
                                  <div className="text-sm">Taken</div>
                                  <UserX size={15} className=" my-auto" />{" "}
                                </div>
                              ) : accountStatus === "Invalid" ? (
                                <div className="flex gap-1">
                                  {" "}
                                  <div className="text-sm">Invalid</div>
                                  <UserX size={15} className=" my-auto" />{" "}
                                </div>
                              ) : (
                                <div className="flex gap-1">
                                  {" "}
                                  <div className="text-sm">Loading</div>
                                  <LoaderCircle
                                    size={15}
                                    className="animate animate-spin my-auto"
                                  />{" "}
                                </div>
                              )}
                            </FormLabel>
                          )}
                          {isDirty && !isCreatingAccount && (
                            <FormLabel className="text-muted-foreground">
                              {accountStatus === "Available" ? (
                                <div className="flex gap-1">
                                  <div className="text-sm">
                                    Account does not exist
                                  </div>
                                  <UserX size={15} className=" my-auto" />{" "}
                                </div>
                              ) : accountStatus === "Invalid" ? (
                                <div className="flex gap-1">
                                  {" "}
                                  <div className="text-sm">Invalid</div>
                                  <UserX size={15} className=" my-auto" />{" "}
                                </div>
                              ) : accountStatus === "Loading" ? (
                                <div className="flex gap-1">
                                  {" "}
                                  <div className="text-sm">Loading</div>
                                  <LoaderCircle
                                    size={15}
                                    className="animate animate-spin my-auto"
                                  />{" "}
                                </div>
                              ) : undefined}
                            </FormLabel>
                          )}
                        </div>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" disabled={disableModalSubmit}>
                    {isCreatingAccount
                      ? `${isSubmitting ? "Accepting" : "Accept"} invite`
                      : `Import account`}
                  </Button>
                </form>
              </Form>
            </DialogHeader>
          </DialogContent>
          <div className="max-w-lg mx-auto">
            <div className="text-center text-muted-foreground py-2">
              <div>
                {isInitialLoading
                  ? "Loading..."
                  : isInvite
                    ? `Select an account to accept invite to `
                    : `Select an account to login to  `}
              </div>
            </div>
            <ActiveSearch
              accounts={accounts}
              setAccountsToRender={setAccountsToRender}
            />
            <div className="flex flex-col gap-3 ">
              <AccountsList
                isAcocuntsLoading={isAccountsLoading}
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
                  className="flex p-4 shrink-0 items-center justify-center rounded-md border border-neutral-600 text-muted-foreground hover:text-primary hover:underline border-dashed"
                >
                  Create a new account
                </button>
              )}
            </div>
            {!isNoAccounts && (
              <div className="my-3">
                <Button
                  disabled={!selectedAccount || isTxInProgress}
                  onClick={() => {
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
                        throw new Error(
                          `Expected connection token for a login`
                        );
                      }
                      login({
                        app: connectionToken.app,
                        origin: connectionToken.origin,
                        accountName: selectedAccount!.account,
                      });
                    }
                  }}
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
            <div className="w-full justify-center flex">
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
              <div className="w-full justify-center flex">
                <Button
                  onClick={() => {
                    setIsCreatingAccount(false);
                    setIsModalOpen(true);
                  }}
                  variant={isNoAccounts ? "default" : "link"}
                  className={cn({ "text-muted-foreground": !isNoAccounts })}
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
