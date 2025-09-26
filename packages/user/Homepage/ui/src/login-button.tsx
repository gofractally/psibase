import { useCreateConnectionToken } from "@/hooks/use-create-connection-token";

import { useAvatar } from "@shared/hooks/use-avatar";
import { Button } from "@shared/shadcn/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@shared/shadcn/ui/dropdown-menu";

import { useConnectedAccounts } from "./hooks/use-connected-accounts";
import { useSelectAccount } from "./hooks/use-select-account";

export const LoginButton = () => {
    const { mutate: login, isPending } = useCreateConnectionToken();
    const { data: connectedAccounts } = useConnectedAccounts();

    const isNoOptions = connectedAccounts && connectedAccounts.length == 0;

    const { isPending: isConnectingToAccount, mutate: onSelect } =
        useSelectAccount();

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
                            <Account account={account} />
                        </DropdownMenuItem>
                    ))}
                <DropdownMenuItem onClick={() => onSelect("-other")}>
                    Other...
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

const Account = ({ account }: { account: string }) => {
    const { avatarSrc } = useAvatar(account);
    return (
        <>
            <img className="mr-2 h-4 w-4 rounded-none" src={avatarSrc} />
            <span>{account}</span>
        </>
    );
};
