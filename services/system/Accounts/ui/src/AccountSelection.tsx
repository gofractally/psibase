import { useMutation } from "@tanstack/react-query";
import { AlarmClockMinus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";

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

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Check, UserX, LoaderCircle } from "lucide-react";
import { TriangleAlert } from "lucide-react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

import { useNavigate, useSearchParams } from "react-router-dom";
import { supervisor } from "@/main";
import { useDecodeInviteToken } from "@/hooks/useDecodeInviteToken";
import { useDecodeConnectionToken } from "@/hooks/useDecodeConnectionToken";
import { useDecodeToken } from "@/hooks/useDecodeToken";
import { useGetAllAccounts } from "@/hooks/useGetAllAccounts";
import { useLoginDirect } from "@/hooks/useLoginDirect";
import { useAcceptInvite } from "@/hooks/useAcceptInvite";
import { useAccountStatus } from "@/hooks/useAccountStatus";

dayjs.extend(relativeTime);

const wait = (ms = 1000) => new Promise((resolve) => setTimeout(resolve, ms));

const capitaliseFirstLetter = (str: string) =>
  str[0].toUpperCase() + str.slice(1);

const Account = ({
  name,
  isSelected,
  onSelected,
}: {
  onSelected: () => void;
  name?: string;
  isSelected: boolean;
}) => {
  return (
    <button
      onClick={() => {
        onSelected();
      }}
      className={cn(
        "w-full flex justify-around p-4 rounded-md border bg-muted/50",
        {
          "bg-accent border ": isSelected,
        }
      )}
    >
      <div className="flex gap-3">
        {!name ? (
          <Skeleton className="h-12 w-12 rounded-full" />
        ) : (
          <Avatar>
            <AvatarFallback>{name.toUpperCase().slice(0, 2)}</AvatarFallback>
          </Avatar>
        )}
        <div className={cn("text-lg flex flex-col justify-center")}>
          {!name ? <Skeleton className="h-4 w-[100px]" /> : name}
        </div>
      </div>
    </button>
  );
};

const formSchema = z.object({
  username: z.string().min(1).max(50),
});

export const AccountSelection = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const key = searchParams.get("key");
  console.log({ key });

  const navigate = useNavigate();
  // HACK

  // auto nav if the key param is present,
  if (key) {
    navigate(`/key?key=${key}`);
  }

  // END HACK

  console.log(key, "is the damn key");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: "",
    },
  });

  const { mutateAsync: importAccount } = useMutation<void, string, string>({
    mutationFn: async (accountName) => {
      await supervisor.functionCall({
        method: "importAccount",
        params: [accountName],
        service: "accounts",
        intf: "admin",
      });
    },
    onSuccess: async () => {
      fetchAccounts();
      setTimeout(() => {
        fetchAccounts();
      }, 2000);
    },
  });

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

  const {
    data: accounts,
    isLoading: isFetching,
    refetch: fetchAccounts,
  } = useGetAllAccounts();

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

  const [activeSearch, setActiveSearch] = useState("");

  const accountsToRender = activeSearch
    ? (accounts || []).filter((account) =>
        account.account.toLowerCase().includes(activeSearch.toLowerCase())
      )
    : accounts || [];

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

  const {
    data: inviteToken,
    isLoading: isLoadingInvite,
    refetch: refetchToken,
  } = useDecodeInviteToken(token, decodedToken?.tag == "invite-token");

  const { data: connectionToken, isLoading: isLoadingConnectionToken } =
    useDecodeConnectionToken(token, decodedToken?.tag == "connection-token");

  const isInitialLoading =
    isLoadingInvite || isLoadingConnectionToken || isLoadingToken;

  const { mutateAsync: createAccount, isSuccess: isInviteClaimed } =
    useMutation<void, string, string>({
      mutationFn: async (account) => {
        if (!inviteToken) throw new Error(`Must have invite`);

        void (await supervisor.functionCall({
          method: "logout",
          params: [],
          service: "accounts",
          intf: "activeApp",
        }));

        void (await supervisor.functionCall({
          method: "acceptWithNewAccount",
          params: [account, token],
          service: "invite",
          intf: "invitee",
        }));

        await wait(2000);

        await importAccount(account);

        void (await supervisor.functionCall({
          method: "loginDirect",
          params: [
            {
              app: inviteToken.app,
              origin: inviteToken.appDomain,
            },
            account,
          ],
          service: "accounts",
          intf: "admin",
        }));
      },
    });

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

  const { mutateAsync: rejectInvite, isPending: isRejecting } = useMutation({
    onSuccess: () => {
      refetchToken();
      setTimeout(() => {
        refetchToken();
      }, 3000);
    },
    mutationFn: async () => {
      if (!inviteToken) {
        throw new Error(`No invite available`);
      }

      const rejectParams = {
        method: "reject",
        params: [token],
        service: "invite",
        intf: "invitee",
      };
      if (selectedAccount) {
        void (await supervisor.functionCall({
          method: "login",
          params: [selectedAccount.account],
          service: "accounts",
          intf: "activeApp",
        }));

        void (await supervisor.functionCall(rejectParams));
      } else {
        void (await supervisor.functionCall({
          method: "logout",
          params: [],
          service: "accounts",
          intf: "activeApp",
        }));

        void (await supervisor.functionCall(rejectParams));
      }
    },
  });

  const { mutateAsync: login, isPending: isLoggingIn } = useLoginDirect();

  const { mutateAsync: acceptInvite, isPending: isAccepting } =
    useAcceptInvite();

  const isTxInProgress = isRejecting || isAccepting || isLoggingIn;

  if (isLoadingInvite) {
    return (
      <Card className="w-[350px] mx-auto mt-4">
        <CardHeader>
          <div className="mx-auto">
            <LoaderCircle className="w-12 h-12 animate-spin" />
          </div>
          <CardTitle className="text-center">Loading...</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (inviteToken?.state == "accepted" && !isInviteClaimed) {
    return (
      <Card className="w-[350px] mx-auto mt-4">
        <CardHeader>
          <div className="mx-auto">
            <TriangleAlert className="w-12 h-12" />
          </div>
          <CardTitle>Invitation already accepted.</CardTitle>
          <CardDescription>
            This invitation has been accepted by{" "}
            <span className="text-primary font-semibold">
              {inviteToken.actor}
            </span>
            .
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (inviteToken?.state == "rejected") {
    return (
      <Card className="w-[350px] mx-auto mt-4">
        <CardHeader>
          <div className="mx-auto">
            <TriangleAlert className="w-12 h-12" />
          </div>
          <CardTitle>Invitation rejected.</CardTitle>
          <CardDescription>
            This invitation has been rejected
            {inviteToken?.actor && inviteToken.actor !== "invite-sys"
              ? ` by ${inviteToken.actor}.`
              : "."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const expiryMessage =
    inviteToken &&
    `This invitation expired ${dayjs().to(inviteToken.expiry)} (${dayjs(
      inviteToken.expiry
    ).format("YYYY/MM/DD HH:mm")}).`;

  if (isExpired) {
    return (
      <Card className="w-[350px] mx-auto mt-4">
        <CardHeader>
          <div className="mx-auto">
            <AlarmClockMinus className="w-12 h-12" />
          </div>
          <CardTitle>Expired invitation</CardTitle>
          <CardDescription>{expiryMessage}</CardDescription>
          <CardDescription>
            Please ask the sender{" "}
            <span className="text-primary">{inviteToken?.inviter}</span> for a
            new one.
          </CardDescription>
        </CardHeader>
      </Card>
    );
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
            {isNoAccounts ? (
              <div className="text-primary">No accounts available</div>
            ) : (
              <div className="relative ml-auto flex-1 md:grow-0 mb-3">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={activeSearch}
                  type="search"
                  onChange={(e) => setActiveSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full rounded-lg bg-background pl-8 "
                />
              </div>
            )}

            <div className="flex flex-col gap-3 ">
              <div className="flex flex-col gap-3 max-h-[600px] overflow-auto">
                {isAccountsLoading
                  ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(
                      (_, index) => (
                        <Account
                          onSelected={() => {}}
                          isSelected={false}
                          key={index}
                        />
                      )
                    )
                  : accountsToRender.map((account) => (
                      <Account
                        onSelected={() => {
                          onAccountSelection(account.id);
                        }}
                        isSelected={selectedAccountId == account.id}
                        key={account.id}
                        name={account.account}
                      />
                    ))}
              </div>
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
