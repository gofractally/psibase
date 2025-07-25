import { cn } from "@shared/lib/utils";
import { Avatar, AvatarFallback } from "@shared/shadcn/ui/avatar";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { AccountType } from "./types";

export const Account = ({
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
                "bg-muted/50 flex w-full justify-around rounded-md border p-4",
                {
                    "bg-accent border ": isSelected,
                },
            )}
        >
            <div className="flex gap-3">
                {!name ? (
                    <Skeleton className="h-12 w-12 rounded-full" />
                ) : (
                    <Avatar>
                        <AvatarFallback>
                            {name.toUpperCase().slice(0, 2)}
                        </AvatarFallback>
                    </Avatar>
                )}
                <div className={cn("flex flex-col justify-center text-lg")}>
                    {!name ? <Skeleton className="h-4 w-[100px]" /> : name}
                </div>
            </div>
        </button>
    );
};

export const AccountsList = ({
    isAccountsLoading,
    accountsToRender,
    selectedAccountId,
    onAccountSelection,
}: {
    isAccountsLoading: boolean;
    accountsToRender: AccountType[];
    selectedAccountId: string;
    onAccountSelection: (accountId: string) => void;
}) => {
    return (
        <div className="flex max-h-[600px] flex-col gap-3 overflow-auto">
            {isAccountsLoading
                ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(
                      (_, index) => (
                          <Account
                              onSelected={() => {}}
                              isSelected={false}
                              key={index}
                          />
                      ),
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
    );
};
