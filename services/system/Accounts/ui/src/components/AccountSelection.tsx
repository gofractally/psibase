import { useMutation, useQuery } from "@tanstack/react-query";
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
  DialogTrigger,
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
import { Button } from "./ui/button";

import { Separator } from "@/components/ui/separator";

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

dayjs.extend(relativeTime);

enum Status {
  Loading,
  Unavailable,
  Available,
}

const randomId = (): string => Math.random().toString().slice(2);

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
          {!name ? (
            <Skeleton className="h-4 w-[100px]" />
          ) : (
            capitaliseFirstLetter(name)
          )}
        </div>
      </div>
    </button>
  );
};

interface AccountType {
  account: string;
  id: string;
}

const hardCodedAccounts: AccountType[] = [
  {
    id: randomId(),
    account: "derp",
  },
  {
    id: randomId(),
    account: "barry",
  },
];

const formSchema = z.object({
  username: z.string().min(3).max(50),
});

const randomDate = (): Date => {
  const inFuture = Math.random() > 0.5;
  const oneWeek = 1000 * 60 * 60 * 24 * 7;

  return inFuture
    ? new Date(new Date().valueOf() + oneWeek)
    : new Date(new Date().valueOf() - oneWeek);
};

const isAccountAvailable = async (accountName: string): Promise<boolean> => {
  await wait(1000);
  return accountName.length > 5 || Math.random() > 0.5;
};

export const AccountSelection = () => {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: "",
    },
  });

  const navigate = useNavigate();

  const { mutateAsync } = useMutation<number, Error, string>({
    mutationFn: async (params) => {
      console.log(params, "are to create a blockchain account");
      return 5;
    },
  });

  const { isDirty, isValid, isSubmitting } = form.formState;

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    console.log("submitting account", values);
    await wait(2000);
    void (await mutateAsync(values.username));
  };

  const username = form.watch("username");

  const [debouncedAccount, setDebouncedAccount] = useState<string>();

  const { data: accountIsAvailable, isLoading: debounceIsLoading } = useQuery({
    queryKey: ["userAccount", debouncedAccount],
    queryFn: async () => isAccountAvailable(debouncedAccount!),
    enabled: !!debouncedAccount,
  });

  const isProcessing = debounceIsLoading || username !== debouncedAccount;

  const status = isProcessing
    ? Status.Loading
    : accountIsAvailable
    ? Status.Available
    : Status.Unavailable;

  const { data: accounts, isFetching } = useQuery({
    queryFn: async (): Promise<AccountType[]> => {
      await wait(2000);
      return hardCodedAccounts;
    },
    queryKey: ["userAccounts"],
  });

  const isAccountsLoading = isFetching && !accounts;
  console.log({ isAccountsLoading });
  const [selectedAccountId, setSelectedAccountId] = useState<string>();

  useEffect(() => {
    const debouncedCb = debounce((formValue) => {
      setDebouncedAccount(formValue.username);
    }, 1000);

    const subscription = form.watch(debouncedCb);

    return () => subscription.unsubscribe();
  }, [form]);

  const appName = "Dashboard";

  const [activeSearch, setActiveSearch] = useState("");

  const accountsToRender = activeSearch
    ? (accounts || []).filter((account) =>
        account.account.toLowerCase().includes(activeSearch.toLowerCase())
      )
    : accounts || [];

  const selectedAccount = (accountsToRender || []).find(
    (account) => account.id == selectedAccountId
  );

  const chainName = "fwe";

  const [searchParams] = useSearchParams();

  const token = searchParams.get("token");
  const redirect = searchParams.get("redirect");

  const { data: invite, isLoading: isLoadingInvite } = useQuery({
    queryKey: ["invite", token],
    queryFn: async () => {
      return {
        inviter: "Barry",
        expiry: randomDate(),
      };
    },
  });

  const inviter = invite?.inviter;
  const isExpired = invite
    ? invite.expiry.valueOf() < new Date().valueOf()
    : false;

  const notFound = false;

  const { mutateAsync: rejectInvite, isPending: isRejecting } = useMutation({
    mutationFn: async () => {
      console.log("hit reject");
      // TODO: reject the invite
    },
  });

  const { mutateAsync: acceptInvite, isPending: isAccepting } = useMutation({
    mutationFn: async () => {
      // TODO: accept the invite

      console.log("meant to move to ", redirect);
      if (window.location && window.location.href && redirect) {
        window.location.href = redirect;
      }
    },
  });

  const isTxInProgress = isRejecting || isAccepting;
  console.log({ chainName, isTxInProgress });

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

  if (notFound) {
    return (
      <Card className="w-[350px] mx-auto mt-4">
        <CardHeader>
          <div className="mx-auto">
            <TriangleAlert className="w-12 h-12" />
          </div>
          <CardTitle>Invitation not found.</CardTitle>
          <CardDescription>
            The invitation token is either invalid or has already been used.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const expiryMessage =
    invite &&
    `This invitation expired ${dayjs().to(invite.expiry)} (${dayjs(
      invite.expiry
    ).format("DD/MM/YYYY HH:mm")}).`;

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
            <span className="text-primary">{inviter}</span> for a new one.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <Dialog>
        <div className="mt-6">
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create an account</DialogTitle>
              <DialogDescription>
                Use this invitation to create an on-chain account and use it to
                connect to the {appName} app.
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
                          {isDirty && (
                            <FormLabel className="text-muted-foreground">
                              {status === Status.Available ? (
                                <div className="flex gap-1">
                                  <div className="text-sm">Available</div>
                                  <Check size={15} className="my-auto" />{" "}
                                </div>
                              ) : status === Status.Unavailable ? (
                                <div className="flex gap-1">
                                  {" "}
                                  <div className="text-sm">Taken</div>
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
                    disabled={
                      !(
                        isValid &&
                        !isProcessing &&
                        accountIsAvailable &&
                        !isSubmitting
                      )
                    }
                  >
                    {isSubmitting ? "Accepting" : "Accept"} invite
                  </Button>
                </form>
              </Form>
            </DialogHeader>
          </DialogContent>

          <div className="max-w-lg mx-auto">
            <div className="text-center text-muted-foreground py-2">
              <span>
                Select an account to accept invite to{" "}
                <span className="text-primary">{appName}</span>
              </span>
            </div>
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
                          setSelectedAccountId(account.id);
                        }}
                        isSelected={selectedAccountId == account.id}
                        key={account.id}
                        name={account.account}
                      />
                    ))}
              </div>
              <DialogTrigger asChild>
                <button className="flex p-4 shrink-0 items-center justify-center rounded-md border border-neutral-600 text-muted-foreground hover:text-primary hover:underline border-dashed">
                  Create a new account
                </button>
              </DialogTrigger>
            </div>
            <div className=" my-3">
              <Button
                onClick={() => {
                  console.log("pressed");
                  acceptInvite();
                }}
                className="w-full"
                disabled={!selectedAccount || form.formState.isLoading}
              >
                {isSubmitting ? "Loading..." : "Accept invite"}
              </Button>
            </div>
            {/* <Separator className="my-8 " /> */}
            <div className="w-full justify-center flex">
              <Button
                onClick={() => rejectInvite()}
                variant="link"
                className="text-muted-foreground"
              >
                Reject invite
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
};
