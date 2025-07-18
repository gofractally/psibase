import { Loader2Icon } from "lucide-react";

import { useChainId } from "@/hooks/use-chain-id";
import { useConnectedAccounts } from "@/hooks/use-connected-accounts";
import { useCreateConnectionToken } from "@/hooks/use-create-connection-token";
import { useSelectAccount } from "@/hooks/use-select-account";
import { createIdenticon } from "@/lib/createIdenticon";

import { Button } from "@shared/shadcn/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@shared/shadcn/ui/dropdown-menu";

export const LoginButton = ({
    isPendingCurrentUser,
}: {
    isPendingCurrentUser: boolean;
}) => {
    const { mutate: login } = useCreateConnectionToken();
    const { data: connectedAccounts, isPending: isPendingConnectedAccounts } =
        useConnectedAccounts();

    const isNoOptions = connectedAccounts && connectedAccounts.length == 0;

    const { isPending: isConnectingToAccount, mutate: onSelect } =
        useSelectAccount();

    const { data: chainId } = useChainId();

    const isLoading = isPendingCurrentUser || isPendingConnectedAccounts;

    return isNoOptions ? (
        <Button
            disabled={isLoading}
            onClick={() => {
                login();
            }}
        >
            {isLoading && <Loader2Icon className="animate-spin" />}
            {isLoading ? "Please wait" : "Log in"}
        </Button>
    ) : (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button>Log in</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                {connectedAccounts
                    .reverse()
                    .slice(0, 5)
                    .map((account) => (
                        <DropdownMenuItem
                            disabled={isConnectingToAccount}
                            key={account}
                            onClick={() => onSelect(account)}
                        >
                            <img
                                className="mr-2 h-4 w-4 rounded-none"
                                src={createIdenticon(chainId + account)}
                            />
                            <span>{account}</span>
                        </DropdownMenuItem>
                    ))}
                <DropdownMenuItem onClick={() => login()}>
                    Other...
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
