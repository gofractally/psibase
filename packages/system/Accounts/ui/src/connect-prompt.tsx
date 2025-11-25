import { CircleUserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { prompt } from "@psibase/common-lib";

import { Avatar } from "@shared/components/avatar";
import { CardContent, CardTitle } from "@shared/shadcn/ui/card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { BrandedGlowingCard } from "./components/branded-glowing-card";
import { useConnectAccount } from "./hooks/use-connect-account";
import { useGetAllAccounts } from "./hooks/use-get-all-accounts";

export const ConnectPrompt = () => {
    const navigate = useNavigate();

    // queries
    const { data: accounts = [], isPending: isPendingAccounts } =
        useGetAllAccounts();

    // mutations
    const connectAccountMutation = useConnectAccount();

    const loading = isPendingAccounts;
    const accountsList = Array.isArray(accounts) ? accounts : [];

    const handleLogin = async (accountName: string) => {
        try {
            await connectAccountMutation.mutateAsync(accountName);
            prompt.finished();
        } catch {
            console.error("Login failed");
        }
    };

    if (loading) {
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
                                    <li
                                        onClick={() => handleLogin(name)}
                                        className="hover:bg-sidebar-accent flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-4"
                                    >
                                        <Avatar
                                            account={name}
                                            className="size-6"
                                        />
                                        <div>{name}</div>
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
