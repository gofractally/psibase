import { CircleUserRound } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { prompt } from "@psibase/common-lib";

import { BrandedGlowingCard } from "@shared/components/branded-glowing-card";
import { ErrorCard } from "@shared/components/error-card";
import { CardContent, CardTitle } from "@shared/shadcn/ui/card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { AccountListItem } from "./components/account-list-item";
import { useConnectAccount } from "./hooks/use-connect-account";
import { useGetAllAccounts } from "./hooks/use-get-all-accounts";
import { useRemoveAccount } from "./hooks/use-remove-account";

export const ConnectPrompt = ({ isPrompt }: { isPrompt?: boolean }) => {
    const navigate = useNavigate();

    // queries
    const { data: accounts, isPending, isSuccess, error } = useGetAllAccounts();

    // mutations
    const connectAccountMutation = useConnectAccount();
    const removeAccountMutation = useRemoveAccount();

    const accountsList = Array.isArray(accounts) ? accounts : [];

    useEffect(() => {
        if (isSuccess && accounts?.length === 0) {
            navigate("/plugin/web/prompt/import");
        }
    }, [accounts, navigate, isSuccess]);

    const handleLogin = async (accountName: string) => {
        if (!isPrompt) return;
        try {
            await connectAccountMutation.mutateAsync(accountName);
            prompt.finished();
        } catch (e) {
            console.error("Login failed");
            console.error(e);
        }
    };

    const handleRemoveAccount = async (accountName: string) => {
        try {
            await removeAccountMutation.mutateAsync(accountName);
        } catch (e) {
            console.error("Remove account failed");
            console.error(e);
        }
    };
    if (error) {
        return (
            <ErrorCard
                error={
                    new Error(
                        "There was an error loading your accounts. Refresh the page to try again.",
                    )
                }
            />
        );
    }

    if (connectAccountMutation.error) {
        return (
            <ErrorCard
                error={
                    new Error(
                        "There was an error logging in. Please try again.",
                    )
                }
            />
        );
    }

    if (isPending) {
        return (
            <BrandedGlowingCard>
                <CardContent className="flex flex-col">
                    <Skeleton className="mb-6 h-8 w-[200px]" />
                    <div className="space-y-2">
                        <Skeleton className="h-4 w-[250px]" />
                        <Skeleton className="h-4 w-[200px]" />
                    </div>
                </CardContent>
            </BrandedGlowingCard>
        );
    }

    return (
        <BrandedGlowingCard>
            <CardContent className="flex flex-1 flex-col">
                <CardTitle className="mb-6 text-3xl font-normal">
                    {isPrompt ? "Choose an account" : "Your accounts"}
                </CardTitle>
                <div className="space-y-3">
                    <ul>
                        {accountsList.map((name) => {
                            return (
                                <div key={`account-${name}`}>
                                    <AccountListItem
                                        name={name}
                                        canLogin={isPrompt}
                                        onLogin={() => handleLogin(name)}
                                        onRemove={() =>
                                            handleRemoveAccount(name)
                                        }
                                    />
                                    <div className="bg-border mx-2 h-px" />
                                </div>
                            );
                        })}
                        <li
                            key="account-use-another"
                            className="hover:bg-sidebar-accent flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-4"
                            onClick={() => {
                                if (isPrompt) {
                                    navigate("/plugin/web/prompt/import");
                                } else {
                                    navigate("/import");
                                }
                            }}
                        >
                            <div className="flex size-6 items-center justify-center">
                                <CircleUserRound className="text-muted-foreground size-5" />
                            </div>
                            <div>
                                {isPrompt
                                    ? "Use another account"
                                    : "Add an account"}
                            </div>
                        </li>
                    </ul>
                </div>
            </CardContent>
        </BrandedGlowingCard>
    );
};
