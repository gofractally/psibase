import { PlusCircle, TriangleAlert } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useSelectAccount } from "@/hooks/useSelectAccount";
import { useConnectedAccounts } from "@/hooks/useConnectedAccounts";
import { useCreateConnectionToken } from "@/hooks/useCreateConnectionToken";
import { useAvatar } from "@/hooks/useAvatar";

interface Props {}

export const NotLoggedIn = ({}: Props) => {
    const { mutate: login } = useCreateConnectionToken();
    const { data: connectedAccounts } = useConnectedAccounts();

    const { mutate: connectToAccount, isPending: isConnectingToAccount } =
        useSelectAccount();

    const isOptions = connectedAccounts && connectedAccounts.length > 0;

    const avatarSrc = useAvatar();

    return (
        <div className="relative flex w-full justify-between rounded-lg border p-4">
            <div className="my-auto flex gap-2">
                <div className="my-auto h-full">
                    <TriangleAlert className="h-4 w-4 text-yellow-500" />
                </div>
                <div>
                    <div className="">Not logged in</div>
                    <div className="text-sm text-muted-foreground">
                        Login to continue.
                    </div>
                </div>
            </div>
            <div className="my-auto">
                {isOptions ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button>Login</Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-56">
                            {connectedAccounts.map((connectedAccount) => (
                                <DropdownMenuItem
                                    disabled={isConnectingToAccount}
                                    key={connectedAccount}
                                    onClick={() =>
                                        connectToAccount(connectedAccount)
                                    }
                                >
                                    <img
                                        className="mr-2 h-4 w-4 rounded-none"
                                        src={avatarSrc}
                                    />
                                    <span>{connectedAccount}</span>
                                </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={() => {
                                    login();
                                }}
                            >
                                <PlusCircle className="mr-2 h-4 w-4" />
                                <span>More...</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : (
                    <Button onClick={() => login()}>Login</Button>
                )}
            </div>
        </div>
    );
};
