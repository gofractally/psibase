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

export const LoginButton = () => {
    const { mutate: login, isPending } = useCreateConnectionToken();
    const { data: connectedAccounts } = useConnectedAccounts();

    const isNoOptions = connectedAccounts && connectedAccounts.length == 0;

    const { isPending: isConnectingToAccount, mutate: onSelect } =
        useSelectAccount();

    const { data: chainId } = useChainId();

    return isNoOptions ? (
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
                <Button>Login</Button>
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
