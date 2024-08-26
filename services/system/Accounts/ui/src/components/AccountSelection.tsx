import { useMutation, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ArrowRight } from "lucide-react";
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

import { Check, UserX, LoaderCircle } from "lucide-react";

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

  const { mutateAsync } = useMutation<number, Error, string>({
    mutationFn: async (params) => {
      console.log(params, "are to create a blockchain account");
      return 5;
    },
  });

  const { isDirty, isValid, isSubmitting } = form.formState;

  console.log({ isDirty, isValid, isSubmitting });
  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    console.log("submitting account", values);
    await wait(2000);
    const res = await mutateAsync(values.username);
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

  const appName = "Invite";

  const [activeSearch, setActiveSearch] = useState("");

  const accountsToRender = activeSearch
    ? (accounts || []).filter((account) =>
        account.account.toLowerCase().includes(activeSearch.toLowerCase())
      )
    : accounts || [];

  const selectedAccount = (accountsToRender || []).find(
    (account) => account.id == selectedAccountId
  );

  return (
    <Dialog>
      <div className="grid grid-cols-2 mt-6">
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
                  {isSubmitting ? "Connecting" : "Connect"} to {appName}
                </Button>
              </form>
            </Form>
          </DialogHeader>
        </DialogContent>

        <div>
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

          <div className="flex flex-col gap-4">
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
        </div>

        <div
          className={cn("my-auto flex flex-col gap-3", {
            "opacity-50": !selectedAccount,
          })}
        >
          <div className="flex justify-center">
            <div className="flex gap-4">
              <Avatar>
                <AvatarFallback>
                  {selectedAccount
                    ? selectedAccount.account.slice(0, 2).toUpperCase()
                    : "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col justify-center">
                <ArrowRight />
              </div>
              <Avatar>
                <AvatarFallback>
                  {appName.toUpperCase().slice(0, 3)}
                </AvatarFallback>
              </Avatar>
            </div>
          </div>
          <div className="text-center text-muted-foreground">
            {selectedAccount ? (
              <span>
                Connect{" "}
                <span className="text-primary ">{selectedAccount.account}</span>{" "}
                to <span className="text-primary ">{appName}</span>
              </span>
            ) : (
              <span>
                Select an <span className="text-primary">account</span> to
                connect to <span className="text-primary">{appName}</span>
              </span>
            )}
          </div>
          <div className="w-full flex justify-center">
            <Button disabled={!selectedAccount || form.formState.isLoading}>
              {isSubmitting ? "Loading..." : "Connect"}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
