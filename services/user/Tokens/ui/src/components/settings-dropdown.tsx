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
} from "@/components/ui/dropdown-menu";
import {
  LogOut,
  Sun,
  Moon,
  UserPlus,
  LogIn,
  PlusCircle,
  Settings,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { useTheme } from "./theme-provider";
import { useConnectedAccounts } from "@/hooks/network/useConnectedAccounts";
import { useLoggedInUser } from "@/hooks/network/useLoggedInUser";
import { useSelectAccount } from "@/hooks/network/useSelectAccount";
import { cn } from "@/lib/utils";

import { useChainId } from "@/hooks/network/useChainId";
import { useLogout } from "@/hooks/network/useLogout";
import { useCreateConnectionToken } from "@/hooks/network/useCreateConnectionToken";
import { Button } from "./ui/button";
import { createIdenticon } from "@/lib/createIdenticon";

export const SettingsDropdown = () => {
  const { setTheme } = useTheme();

  const { data: connectedAccounts, isFetched: isFetchedConnectedAccounts } =
    useConnectedAccounts();

  const isNoOptions = connectedAccounts.length == 0;

  const { data: chainId, isFetched: isFetchedChainId } = useChainId();

  const { data: currentUser, isFetched: isFetchedLoggedInuser } =
    useLoggedInUser();

  const { mutateAsync, isPending: isConnectingToAccount } = useSelectAccount();

  const { mutateAsync: logout } = useLogout();
  const { mutateAsync: login } = useCreateConnectionToken();

  const connectToAccount = async (account: string) => {
    void (await mutateAsync(account));
  };

  const isLoading =
    !(
      isFetchedLoggedInuser &&
      isFetchedConnectedAccounts &&
      isFetchedChainId
    ) || isConnectingToAccount;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {currentUser ? (
          <button className="h-10">
            <Avatar className={cn("hover:opacity-25 h-10 rounded-none")}>
              {currentUser ? (
                <AvatarImage src={createIdenticon(chainId + currentUser)} />
              ) : (
                <div>Loading..</div>
              )}
              <AvatarFallback>CN</AvatarFallback>
            </Avatar>
          </button>
        ) : (
          <Button variant="ghost" className="h-10 py-0">
            <Settings className="h-4 w-4" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>{currentUser || "Not logged in"}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {isNoOptions ? (
          <DropdownMenuItem
            onClick={() => {
              login();
            }}
            disabled={!isFetchedConnectedAccounts}
          >
            <LogIn className="mr-2 h-4 w-4" />
            <span>{!isFetchedConnectedAccounts ? "Loading..." : "Login"}</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={isLoading}>
                <UserPlus className="mr-2 h-4 w-4" />
                <span className={cn({ italic: isLoading })}>
                  {currentUser ? "Switch account" : "Select account"}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {connectedAccounts.map((connectedAccount) => (
                    <DropdownMenuItem
                      disabled={isConnectingToAccount}
                      key={connectedAccount}
                      onClick={() => connectToAccount(connectedAccount)}
                    >
                      <img
                        className="mr-2 h-4 w-4 rounded-none"
                        src={createIdenticon(chainId + connectedAccount)}
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
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </DropdownMenuGroup>
        )}
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Moon className="mr-2 h-4 w-4" />
              <span>Theme</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => setTheme("light")}>
                  <Sun className="mr-2 h-4 w-4" />
                  <span>Light</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("dark")}>
                  <Moon className="mr-2 h-4 w-4" />
                  <span>Dark</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setTheme("system")}>
                  <Sun className="mr-2 h-4 w-4" />
                  <span>System</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => {
            logout();
          }}
          disabled={!currentUser}
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
