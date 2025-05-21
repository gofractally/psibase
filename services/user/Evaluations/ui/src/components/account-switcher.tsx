import {
    useCreateConnectionToken,
    useCurrentAccounts,
    useLogout,
    useSelectAccount,
} from "@hooks";
import { useCurrentUser } from "@hooks/use-current-user";
import { Avatar, AvatarFallback } from "@shadcn/avatar";

import { Button } from "@shadcn/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuPortal,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@shadcn/dropdown-menu";
import { LogIn, LogOut, PlusCircle, User, UserPlus } from "lucide-react";

export function AccountSwitcher() {
    const { mutateAsync: onLogin } = useCreateConnectionToken();

    const { data: currentUser } = useCurrentUser();
    const isLoggedIn = !!currentUser;

    const { data: currentAccounts, isPending: isLoadingAccounts } =
        useCurrentAccounts();

    const isNoOptions = !isLoggedIn && currentAccounts.length == 0;

    const { mutateAsync: onLogout } = useLogout();
    const { mutateAsync: selectAccount } = useSelectAccount();

    const otherConnectedAccounts = currentAccounts.filter(
        (account) => account !== currentUser,
    );

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="my-2">
                    <User className="h-4 w-4" />
                    {currentUser?.slice(0, 1)}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side="bottom"
                align="end"
                sideOffset={4}
            >
                {currentUser ? (
                    <>
                        <DropdownMenuLabel className="p-0 font-normal">
                            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                                <Avatar className="h-8 w-8 rounded-lg">
                                    <AvatarFallback className="rounded-lg">
                                        {currentUser[0]}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-semibold">
                                        {currentUser}
                                    </span>
                                </div>
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                    </>
                ) : null}
                {isNoOptions && (
                    <DropdownMenuItem
                        onClick={() => {
                            onLogin();
                        }}
                    >
                        <LogIn className="mr-2 h-4 w-4" />
                        <span>
                            {isLoadingAccounts ? "Loading..." : "Log in"}
                        </span>
                    </DropdownMenuItem>
                )}
                {!isNoOptions && !otherConnectedAccounts.length ? (
                    <DropdownMenuItem
                        onClick={() => {
                            onLogin();
                        }}
                    >
                        <UserPlus className="mr-2 h-4 w-4" />
                        <span>Switch account</span>
                    </DropdownMenuItem>
                ) : null}
                {!isNoOptions && otherConnectedAccounts.length ? (
                    <DropdownMenuGroup>
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                                <UserPlus className="mr-2 h-4 w-4" />
                                <span>
                                    {currentUser
                                        ? "Switch account"
                                        : "Select an account"}
                                </span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuPortal>
                                <DropdownMenuSubContent>
                                    {otherConnectedAccounts.map((account) => (
                                        <DropdownMenuItem
                                            key={account}
                                            onClick={() => {
                                                selectAccount(account);
                                            }}
                                        >
                                            <User className="mr-2 h-4 w-4" />
                                            <span>{account}</span>
                                        </DropdownMenuItem>
                                    ))}
                                    {otherConnectedAccounts.length ? (
                                        <DropdownMenuSeparator />
                                    ) : null}
                                    <DropdownMenuItem
                                        onClick={() => {
                                            onLogin();
                                        }}
                                    >
                                        <PlusCircle className="mr-2 h-4 w-4" />
                                        <span>More...</span>
                                    </DropdownMenuItem>
                                </DropdownMenuSubContent>
                            </DropdownMenuPortal>
                        </DropdownMenuSub>
                    </DropdownMenuGroup>
                ) : null}
                <DropdownMenuItem
                    disabled={!isLoggedIn}
                    onClick={() => {
                        onLogout();
                    }}
                >
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
