import {
  ChevronsUpDown,
  LogIn,
  LogOut,
  Moon,
  PlusCircle,
  Sun,
  Terminal,
  UserPlus,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { createIdenticon, generateAvatar } from "@/lib/createIdenticon";
import { useChainId } from "@/hooks/use-chain-id";
import { useLogout } from "@/hooks/useLogout";
import { useTheme } from "./theme-provider";
import { useConnectedAccounts } from "@/hooks/use-connected-accounts";
import { useCreateConnectionToken } from "@/hooks/useCreateConnectionToken";
import { useSelectAccount } from "@/hooks/use-select-account";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { useSpa } from "@/hooks/useSpa";

export function NavUser() {
  const { isMobile } = useSidebar();

  const { data: currentUser, isFetched: isFetchedLoggedInuser } =
    useCurrentUser();

  const { data: chainId, isFetched: isFetchedChainId } = useChainId();
  const { mutateAsync: logout } = useLogout();
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout();
    navigate("/");
  };

  const { setTheme } = useTheme();

  const { mutate: enableSpa, isPending: isEnablingSpa } = useSpa();

  const { data: connectedAccounts, isFetched: isFetchedConnectedAccounts } =
    useConnectedAccounts();

  const { mutateAsync: login } = useCreateConnectionToken();
  const { mutateAsync: connectToAccount, isPending: isConnectingToAccount } =
    useSelectAccount();

  const isNoOptions = connectedAccounts.length == 0;
  const isUsingOnlyOption =
    connectedAccounts.length == 1 && connectedAccounts[0] === currentUser;
  const isLoading =
    !(
      isFetchedLoggedInuser &&
      isFetchedConnectedAccounts &&
      isFetchedChainId
    ) || isConnectingToAccount;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage
                  src={generateAvatar(chainId, currentUser || "")}
                  alt={currentUser || ""}
                />
                <AvatarFallback className="rounded-lg">CN</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  {currentUser || ""}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage
                    src={generateAvatar(chainId, currentUser || "")}
                  />
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {currentUser || ""}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {isNoOptions || isUsingOnlyOption ? (
              <DropdownMenuItem
                onClick={() => {
                  login();
                }}
                disabled={!isFetchedConnectedAccounts}
              >
                <LogIn className="mr-2 h-4 w-4" />
                <span>
                  {!isFetchedConnectedAccounts
                    ? "Loading..."
                    : isUsingOnlyOption
                    ? "Switch account"
                    : "Login"}
                </span>
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
              onClick={() =>
                enableSpa({ account: "workshop", enableSpa: true })
              }
              disabled={isEnablingSpa}
            >
              <Terminal />
              Enable SPA on workshop
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onLogout()}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
