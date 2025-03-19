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
} from "./ui/dropdown-menu";

import {
  Settings,
  LogOut,
  Sun,
  Moon,
  UserPlus,
  LogIn,
  PlusCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTheme } from "./theme-provider";
import { useLogout } from "@/hooks/useLogout";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCreateConnectionToken } from "@/hooks/useCreateConnectionToken";
import { useChainId } from "@/hooks/use-chain-id";
import { useConnectedAccounts } from "@/hooks/use-connected-accounts";
import { useSelectAccount } from "@/hooks/use-select-account";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { createIdenticon, generateAvatar } from "@/lib/createIdenticon";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

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
            className="flex items-center gap-2 px-3 py-2 h-10 rounded-md border border-input hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            {chainId && (
              <Avatar className="h-6 w-6 rounded-md">
                <AvatarImage
                  src={generateAvatar(chainId, currentUser || "")}
                  alt={currentUser}
                />
                <AvatarFallback>
                  {currentUser?.[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
            )}
            <span className="truncate max-w-[120px] text-sm font-medium">
              {currentUser}
            </span>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <Settings className="h-5 w-5" />
            <span className="sr-only">Settings</span>
          </Button>
        )}
      </DropdownMenuTrigger>

      {/* Dropdown Content */}
      <DropdownMenuContent className="w-64 p-1 rounded-md shadow-lg border border-border bg-background">
        {isLoggedIn && (
          <>
            <DropdownMenuLabel className="px-2 py-1.5 font-semibold text-sm text-foreground">
              <div className="flex items-center gap-2">
                <Avatar className="h-8 w-8 rounded-md">
                  <AvatarImage
                    src={generateAvatar(chainId, currentUser || "")}
                  />
                  <AvatarFallback>
                    {currentUser?.[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 truncate text-sm">
                  <span className="font-medium">{currentUser}</span>
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
                className="px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground transition-colors cursor-pointer"
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
                  className="px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground transition-colors"
                >
                  <UserPlus className="mr-2 h-4 w-4" />
                  <span className={cn({ "italic opacity-60": isLoading })}>
                    {currentUser ? "Switch Account" : "Select Account"}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="w-56 p-1 rounded-md shadow-lg border border-border bg-background">
                    {connectedAccounts?.map((connectedAccount) => (
                      <DropdownMenuItem
                        key={connectedAccount}
                        onClick={() => connectToAccount(connectedAccount)}
                        disabled={isConnectingToAccount}
                        className="px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground transition-colors cursor-pointer"
                      >
                        <img
                          className="mr-2 h-4 w-4 rounded-none"
                          src={createIdenticon(chainId + connectedAccount)}
                          alt={connectedAccount}
                        />
                        <span className="truncate max-w-[180px]">
                          {connectedAccount}
                        </span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator className="my-1" />
                    <DropdownMenuItem
                      onClick={() => login()}
                      className="px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground transition-colors cursor-pointer"
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
            <DropdownMenuSubTrigger className="px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground transition-colors">
              <Moon className="mr-2 h-4 w-4" />
              <span>Theme</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className="w-48 p-1 rounded-md shadow-lg border border-border bg-background">
                <DropdownMenuItem
                  onClick={() => setTheme("light")}
                  className="px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground transition-colors cursor-pointer"
                >
                  <Sun className="mr-2 h-4 w-4" />
                  <span>Light</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setTheme("dark")}
                  className="px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground transition-colors cursor-pointer"
                >
                  <Moon className="mr-2 h-4 w-4" />
                  <span>Dark</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="my-1" />
                <DropdownMenuItem
                  onClick={() => setTheme("system")}
                  className="px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground transition-colors cursor-pointer"
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
            className="px-2 py-1.5 text-sm  rounded-sm cursor-pointer"
          >
            <LogOut className="mr-2 h-4 w-4" />
            <span>Log Out</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() => login()}
            className="px-2 py-1.5 text-sm text-primary rounded-sm hover:bg-primary/10 hover:text-primary focus:bg-primary/10 focus:text-primary transition-colors cursor-pointer"
          >
            <LogIn className="mr-2 h-4 w-4" />
            <span>Log In</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
