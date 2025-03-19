import { useCreateConnectionToken } from "@/hooks/useCreateConnectionToken";
import { Button } from "./components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConnectedAccounts } from "./hooks/useConnectedAccounts";
import { useSelectAccount } from "./hooks/useSelectAccount";
import { useChainId } from "./hooks/useChainId";
import { createIdenticon } from "@/lib/createIdenticon";

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
                <DropdownMenuItem onClick={() => onSelect("-other")}>
                    Other...
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
