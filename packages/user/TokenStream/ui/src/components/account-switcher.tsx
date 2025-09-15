import { LogIn, LogOut, PlusCircle, User, UserPlus } from "lucide-react";

import {
    useCreateConnectionToken,
    useCurrentAccounts,
    useCurrentUser,
    useLogout,
    useSelectAccount,
} from "@/hooks";

import { Avatar, AvatarFallback } from "@shared/shadcn/ui/avatar";
import { Button } from "@shared/shadcn/ui/button";
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
} from "@shared/shadcn/ui/dropdown-menu";

export function AccountSwitcher() {
    const { mutateAsync: onLogin } = useCreateConnectionToken();

    const { data: loggedInUser } = useCurrentUser();
    const isLoggedIn = !!loggedInUser;

    const { data: currentAccounts, isPending: isLoadingAccounts } =
        useCurrentAccounts();

    const isNoOptions = !isLoggedIn && currentAccounts.length == 0;

    const { mutateAsync: onLogout } = useLogout();
    const { mutateAsync: selectAccount } = useSelectAccount();

    const otherConnectedAccounts = currentAccounts.filter(
        (account) => account !== loggedInUser,
    );

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="my-2">
                    <User className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side="bottom"
                align="end"
                sideOffset={4}
            >
                {loggedInUser ? (
                    <>
                        <DropdownMenuLabel className="p-0 font-normal">
                            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                                <Avatar className="h-8 w-8 rounded-lg">
                                    <AvatarFallback className="rounded-lg">
                                        {loggedInUser[0]}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-semibold">
                                        {loggedInUser}
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
                                    {loggedInUser
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
