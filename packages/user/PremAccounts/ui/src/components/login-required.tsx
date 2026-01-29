import type React from "react";
import { useEffect, useState } from "react";

import { useCurrentAccounts, useLoggedInUser, useSelectAccount } from "@/hooks";

import { useChainId } from "@shared/hooks/use-chain-id";
import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { createIdenticon } from "@shared/lib/create-identicon";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@shared/shadcn/ui/dropdown-menu";

type Props = {
    children: React.ReactNode;
};

const Other = "-other" as const;

// LoginRequired: matches the wallet/config login dialog/overlay UX.
export const LoginRequired: React.FC<Props> = ({ children }) => {
    const [showModal, setShowModal] = useState(false);
    const [isAwaitingLogin, setIsAwaitingLogin] = useState(false);

    // Always fetch current user; query is invalidated by account selection/login hooks
    const { data: loggedInUser, status } = useLoggedInUser(true);
    const { data: currentAccounts = [] } = useCurrentAccounts();

    const isNoOptions = currentAccounts.length === 0;

    const { mutate: login, isPending } = useConnectAccount();
    const { mutateAsync: selectAccount, isPending: isConnectingToAccount } =
        useSelectAccount();

    const { data: chainId } = useChainId();

    useEffect(() => {
        // Mirror Config behavior: only show the dialog once we definitively know
        // there is no current user.
        if (status === "success" && !loggedInUser) {
            setShowModal(true);
        }

        if (loggedInUser) {
            setShowModal(false);
            setIsAwaitingLogin(false);
        }
    }, [status, loggedInUser, isAwaitingLogin]);

    const onSelect = async (account: string): Promise<void> => {
        if (account === Other) {
            await login();
            setIsAwaitingLogin(true);
        } else {
            await selectAccount(account);
            setShowModal(false);
        }
    };

    return (
        <Dialog
            open={showModal}
            onOpenChange={(open) => {
                const isRefusingToLogin = !open && loggedInUser === null;
                if (isRefusingToLogin) {
                    // If the user closes without logging in, keep showing the modal
                    setShowModal(true);
                } else {
                    setShowModal(open);
                }
            }}
        >
            {children}
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Login required</DialogTitle>
                    <DialogDescription>
                        You must be logged in to purchase premium account names.
                    </DialogDescription>
                    <div className="mt-4 flex w-full justify-end">
                        {isNoOptions ? (
                            <Button
                                disabled={isPending}
                                onClick={() => {
                                    login();
                                }}
                            >
                                Login
                            </Button>
                        ) : (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button>
                                        {isAwaitingLogin ? "Retry" : "Login"}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                    {currentAccounts
                                        .slice()
                                        .reverse()
                                        .slice(0, 5)
                                        .map((account) => (
                                            <DropdownMenuItem
                                                disabled={isConnectingToAccount}
                                                key={account}
                                                onClick={() => onSelect(account)}
                                            >
                                                {chainId && (
                                                    <img
                                                        className="mr-2 h-4 w-4 rounded-none"
                                                        src={createIdenticon(
                                                            chainId + account,
                                                        )}
                                                    />
                                                )}
                                                <span>{account}</span>
                                            </DropdownMenuItem>
                                        ))}
                                    <DropdownMenuItem
                                        onClick={() => onSelect(Other)}
                                    >
                                        Other...
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                    </div>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};


