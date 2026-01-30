import { CircleUserRound, LogOut } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { prompt } from "@psibase/common-lib";

import { Avatar } from "@shared/components/avatar";
import { BrandedGlowingCard } from "@shared/components/branded-glowing-card";
import { ErrorCard } from "@shared/components/error-card";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@shared/shadcn/ui/alert-dialog";
import { Button } from "@shared/shadcn/ui/button";
import { CardContent, CardTitle } from "@shared/shadcn/ui/card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { useConnectAccount } from "./hooks/use-connect-account";
import { useGetAllAccounts } from "./hooks/use-get-all-accounts";
import { useRemoveAccount } from "./hooks/use-remove-account";

export const ConnectPrompt = () => {
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
                    Choose an account
                </CardTitle>
                <div className="space-y-3">
                    <ul>
                        {accountsList.map((name) => {
                            return (
                                <div key={`account-${name}`}>
                                    <li className="hover:bg-sidebar-accent flex select-none items-center rounded-md px-2 py-4">
                                        <button
                                            onClick={() => handleLogin(name)}
                                            className="flex flex-1 items-center gap-2"
                                        >
                                            <Avatar
                                                account={name}
                                                className="size-6"
                                            />
                                            {name}
                                        </button>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    className="cursor-pointer"
                                                >
                                                    <LogOut />
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>
                                                        Remove account?
                                                    </AlertDialogTitle>
                                                </AlertDialogHeader>
                                                <AlertDialogDescription>
                                                    This will remove the account{" "}
                                                    <span className="text-primary">
                                                        {name}
                                                    </span>{" "}
                                                    from this browser and will
                                                    sign it out of any connected
                                                    apps.
                                                </AlertDialogDescription>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>
                                                        Cancel
                                                    </AlertDialogCancel>
                                                    <AlertDialogAction
                                                        onClick={() => {
                                                            handleRemoveAccount(
                                                                name,
                                                            );
                                                        }}
                                                    >
                                                        Remove
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </li>
                                    <div className="bg-border mx-2 h-px" />
                                </div>
                            );
                        })}
                        <li
                            key="account-use-another"
                            className="hover:bg-sidebar-accent flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-4"
                            onClick={() => {
                                navigate("/plugin/web/prompt/import");
                            }}
                        >
                            <div className="flex size-6 items-center justify-center">
                                <CircleUserRound className="text-muted-foreground size-5" />
                            </div>
                            <div>Use another account</div>
                        </li>
                    </ul>
                </div>
            </CardContent>
        </BrandedGlowingCard>
    );
};
