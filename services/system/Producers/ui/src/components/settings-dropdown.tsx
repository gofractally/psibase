import {
    LogIn,
    LogOut,
    Moon,
    PlusCircle,
    Settings,
    Sun,
    UserPlus,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useTheme } from "@/components/theme-provider";

import { useChainId } from "@/hooks/use-chain-id";
import { useConnectedAccounts } from "@/hooks/use-connected-accounts";
import { useSelectAccount } from "@/hooks/use-select-account";
import { useCreateConnectionToken } from "@/hooks/useCreateConnectionToken";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLogout } from "@/hooks/useLogout";
import { createIdenticon, generateAvatar } from "@/lib/createIdenticon";

import { cn } from "@shared/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@shared/shadcn/ui/avatar";
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

export const SettingsDropdown = () => {
    const { setTheme } = useTheme();
    const navigate = useNavigate();

    const { mutateAsync: logout } = useLogout();
    const { data: currentUser, isFetched: isFetchedLoggedInuser } =
        useCurrentUser();
    const { mutateAsync: login } = useCreateConnectionToken();
    const { data: chainId, isFetched: isFetchedChainId } = useChainId();
    const { data: connectedAccounts, isFetched: isFetchedConnectedAccounts } =
        useConnectedAccounts();
    const { mutateAsync: connectToAccount, isPending: isConnectingToAccount } =
        useSelectAccount();

    const isLoggedIn = !!currentUser;
    const isNoOptions = connectedAccounts?.length === 0;
    const isUsingOnlyOption =
        connectedAccounts?.length === 1 && connectedAccounts[0] === currentUser;
    const isLoading =
        !(
            isFetchedLoggedInuser &&
            isFetchedConnectedAccounts &&
            isFetchedChainId
        ) || isConnectingToAccount;

    const onLogout = async () => {
        await logout();
        navigate("/");
    };

    return (
        <DropdownMenu>
            {/* Trigger Button */}
            <DropdownMenuTrigger asChild>
                {isLoggedIn ? (
                    <Button
                        variant="outline"
                        className="border-input hover:bg-accent hover:text-accent-foreground flex h-10 items-center gap-2 rounded-md border px-3 py-2 transition-colors"
                    >
                        {chainId && (
                            <Avatar className="h-6 w-6 rounded-md">
                                <AvatarImage
                                    src={generateAvatar(
                                        chainId,
                                        currentUser || "",
                                    )}
                                    alt={currentUser}
                                />
                                <AvatarFallback>
                                    {currentUser?.[0]?.toUpperCase()}
                                </AvatarFallback>
                            </Avatar>
                        )}
                        <span className="max-w-[120px] truncate text-sm font-medium">
                            {currentUser}
                        </span>
                    </Button>
                ) : (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="hover:bg-accent hover:text-accent-foreground h-10 w-10 rounded-md transition-colors"
                    >
                        <Settings className="h-5 w-5" />
                        <span className="sr-only">Settings</span>
                    </Button>
                )}
            </DropdownMenuTrigger>

            {/* Dropdown Content */}
            <DropdownMenuContent className="border-border bg-background w-64 rounded-md border p-1 shadow-lg">
                {isLoggedIn && (
                    <>
                        <DropdownMenuLabel className="text-foreground px-2 py-1.5 text-sm font-semibold">
                            <div className="flex items-center gap-2">
                                <Avatar className="h-8 w-8 rounded-md">
                                    <AvatarImage
                                        src={generateAvatar(
                                            chainId,
                                            currentUser || "",
                                        )}
                                    />
                                    <AvatarFallback>
                                        {currentUser?.[0]?.toUpperCase()}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 truncate text-sm">
                                    <span className="font-medium">
                                        {currentUser}
                                    </span>
                                </div>
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator className="my-1" />
                    </>
                )}

                {isLoggedIn && (
                    <DropdownMenuGroup>
                        {isNoOptions || isUsingOnlyOption ? (
                            <DropdownMenuItem
                                onClick={() => login()}
                                disabled={!isFetchedConnectedAccounts}
                                className="hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground cursor-pointer rounded-sm px-2 py-1.5 text-sm transition-colors"
                            >
                                <LogIn className="mr-2 h-4 w-4" />
                                <span>
                                    {!isFetchedConnectedAccounts
                                        ? "Loading..."
                                        : isUsingOnlyOption
                                          ? "Switch Account"
                                          : "Login"}
                                </span>
                            </DropdownMenuItem>
                        ) : (
                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger
                                    disabled={isLoading}
                                    className="hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground rounded-sm px-2 py-1.5 text-sm transition-colors"
                                >
                                    <UserPlus className="mr-2 h-4 w-4" />
                                    <span
                                        className={cn({
                                            "italic opacity-60": isLoading,
                                        })}
                                    >
                                        {currentUser
                                            ? "Switch Account"
                                            : "Select Account"}
                                    </span>
                                </DropdownMenuSubTrigger>
                                <DropdownMenuPortal>
                                    <DropdownMenuSubContent className="border-border bg-background w-56 rounded-md border p-1 shadow-lg">
                                        {connectedAccounts?.map(
                                            (connectedAccount) => (
                                                <DropdownMenuItem
                                                    key={connectedAccount}
                                                    onClick={() =>
                                                        connectToAccount(
                                                            connectedAccount,
                                                        )
                                                    }
                                                    disabled={
                                                        isConnectingToAccount
                                                    }
                                                    className="hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground cursor-pointer rounded-sm px-2 py-1.5 text-sm transition-colors"
                                                >
                                                    <img
                                                        className="mr-2 h-4 w-4 rounded-none"
                                                        src={createIdenticon(
                                                            chainId +
                                                                connectedAccount,
                                                        )}
                                                        alt={connectedAccount}
                                                    />
                                                    <span className="max-w-[180px] truncate">
                                                        {connectedAccount}
                                                    </span>
                                                </DropdownMenuItem>
                                            ),
                                        )}
                                        <DropdownMenuSeparator className="my-1" />
                                        <DropdownMenuItem
                                            onClick={() => login()}
                                            className="hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground cursor-pointer rounded-sm px-2 py-1.5 text-sm transition-colors"
                                        >
                                            <PlusCircle className="mr-2 h-4 w-4" />
                                            <span>Connect New Account</span>
                                        </DropdownMenuItem>
                                    </DropdownMenuSubContent>
                                </DropdownMenuPortal>
                            </DropdownMenuSub>
                        )}
                    </DropdownMenuGroup>
                )}

                {/* Theme Options */}
                <DropdownMenuGroup>
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground rounded-sm px-2 py-1.5 text-sm transition-colors">
                            <Moon className="mr-2 h-4 w-4" />
                            <span>Theme</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuPortal>
                            <DropdownMenuSubContent className="border-border bg-background w-48 rounded-md border p-1 shadow-lg">
                                <DropdownMenuItem
                                    onClick={() => setTheme("light")}
                                    className="hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground cursor-pointer rounded-sm px-2 py-1.5 text-sm transition-colors"
                                >
                                    <Sun className="mr-2 h-4 w-4" />
                                    <span>Light</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => setTheme("dark")}
                                    className="hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground cursor-pointer rounded-sm px-2 py-1.5 text-sm transition-colors"
                                >
                                    <Moon className="mr-2 h-4 w-4" />
                                    <span>Dark</span>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="my-1" />
                                <DropdownMenuItem
                                    onClick={() => setTheme("system")}
                                    className="hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground cursor-pointer rounded-sm px-2 py-1.5 text-sm transition-colors"
                                >
                                    <Sun className="mr-2 h-4 w-4" />
                                    <span>System</span>
                                </DropdownMenuItem>
                            </DropdownMenuSubContent>
                        </DropdownMenuPortal>
                    </DropdownMenuSub>
                </DropdownMenuGroup>

                <DropdownMenuSeparator className="my-1" />

                {/* Logout/Login Button */}
                {isLoggedIn ? (
                    <DropdownMenuItem
                        onClick={onLogout}
                        className="cursor-pointer rounded-sm px-2  py-1.5 text-sm"
                    >
                        <LogOut className="mr-2 h-4 w-4" />
                        <span>Log Out</span>
                    </DropdownMenuItem>
                ) : (
                    <DropdownMenuItem
                        onClick={() => login()}
                        className="text-primary hover:bg-primary/10 hover:text-primary focus:bg-primary/10 focus:text-primary cursor-pointer rounded-sm px-2 py-1.5 text-sm transition-colors"
                    >
                        <LogIn className="mr-2 h-4 w-4" />
                        <span>Log In</span>
                    </DropdownMenuItem>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
