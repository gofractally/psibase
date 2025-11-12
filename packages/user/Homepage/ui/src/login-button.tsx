import { Avatar } from "@shared/components/avatar";
import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { Button } from "@shared/shadcn/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@shared/shadcn/ui/dropdown-menu";
import { toast } from "@shared/shadcn/ui/sonner";

import { useConnectedAccounts } from "./hooks/use-connected-accounts";
import { useSelectAccount } from "./hooks/use-select-account";

export const LoginButton = () => {
    const { mutate: login, isPending } = useConnectAccount({
        onError: (error) => {
            toast.error(error.message);
        },
    });
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
    return (
        <>
            <Avatar account={account} className="mr-2 h-4 w-4" />
            <span>{account}</span>
        </>
    );
};
