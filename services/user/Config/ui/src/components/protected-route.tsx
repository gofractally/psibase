import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useChainId } from "@/hooks/use-chain-id";
import { useConnectedAccounts } from "@/hooks/use-connected-accounts";
import { useSelectAccount } from "@/hooks/use-select-account";
import { useCreateConnectionToken } from "@/hooks/useCreateConnectionToken";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { createIdenticon } from "@/lib/createIdenticon";

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

const Other = "-other" as const;

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
    const [showModal, setShowModal] = useState(false);

    const [isAwaitingLogin, setIsAwaitingLogin] = useState(false);

    const refetchInterval = isAwaitingLogin ? 1000 : undefined;

    const { data: currentUser } = useCurrentUser(refetchInterval);
    const { data: connectedAccounts } = useConnectedAccounts();

    const isNoOptions = connectedAccounts.length == 0;
    const { mutate: login, isPending } = useCreateConnectionToken();
    const { mutateAsync: selectAccount, isPending: isConnectingToAccount } =
        useSelectAccount();

    const navigate = useNavigate();

    const { data: chainId } = useChainId();

    useEffect(() => {
        if (isAwaitingLogin && currentUser) {
            setShowModal(false);
            setIsAwaitingLogin(false);
        }
    }, [isAwaitingLogin, currentUser]);

    const onSelect = async (account: string): Promise<void> => {
        if (account === Other) {
            await login();
            setIsAwaitingLogin(true);
        } else {
            await selectAccount(account);
            setShowModal(false);
        }
    };

    useEffect(() => {
        if (currentUser === null) {
            setShowModal(true);
        }
    }, [currentUser]);

    return (
        <Dialog
            open={showModal}
            onOpenChange={(open) => {
                const isRefusingToLogin = !open && currentUser === null;
                if (isRefusingToLogin) {
                    navigate("/");
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
                        You must be logged in to visit this page.
                    </DialogDescription>
                    <div className="flex w-full justify-end">
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
                                    {connectedAccounts
                                        .reverse()
                                        .slice(0, 5)
                                        .map((account) => (
                                            <DropdownMenuItem
                                                disabled={isConnectingToAccount}
                                                key={account}
                                                onClick={() =>
                                                    onSelect(account)
                                                }
                                            >
                                                <img
                                                    className="mr-2 h-4 w-4 rounded-none"
                                                    src={createIdenticon(
                                                        chainId + account,
                                                    )}
                                                />
                                                <span>{account}</span>
                                            </DropdownMenuItem>
                                        ))}
                                    <DropdownMenuItem
                                        onClick={() => onSelect("-other")}
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
