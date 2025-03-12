import {
    ChevronsUpDown,
    LogIn,
    LogOut,
    Moon,
    PlusCircle,
    Sun,
    UserPlus,
    Download,
    User,
    Copy,
    RefreshCcw,
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
import { useChainId } from "@/hooks/useChainId";
import { useLogout } from "@/hooks/useLogout";
import { useTheme } from "./theme-provider";
import { useConnectedAccounts } from "@/hooks/useConnectedAccounts";
import { useCreateConnectionToken } from "@/hooks/useCreateConnectionToken";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { useSelectAccount } from "@/hooks/useSelectAccount";
import { useGenerateInvite } from "@/hooks/useGenerateInvite";
import { useCanExportAccount } from "@/hooks/useCanExportAccount";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { type UseMutationResult } from "@tanstack/react-query";
import { siblingUrl } from "@psibase/common-lib";

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

    const { data: connectedAccounts, isFetched: isFetchedConnectedAccounts } =
        useConnectedAccounts();

    const { mutateAsync: login } = useCreateConnectionToken();
    const { mutateAsync: connectToAccount, isPending: isConnectingToAccount } =
        useSelectAccount();

    const generateInvite = useGenerateInvite();
    const { data: canExportAccount } = useCanExportAccount(currentUser);

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
        <Dialog>
            <InviteDialogContent generateInvite={generateInvite} />
            <SidebarMenu>
                <SidebarMenuItem>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <SidebarMenuButton
                                size="lg"
                                className="data-[state=open]:bg-sidebar-accent  data-[state=open]:text-sidebar-accent-foreground"
                            >
                                <Avatar className="h-8 w-8 rounded-lg">
                                    <AvatarImage
                                        src={
                                            chainId && currentUser
                                                ? generateAvatar(
                                                      chainId,
                                                      currentUser,
                                                  )
                                                : undefined
                                        }
                                        alt={currentUser || ""}
                                    />
                                    <AvatarFallback className="rounded-lg">
                                        ?
                                    </AvatarFallback>
                                </Avatar>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate ">
                                        {currentUser || "Not logged in"}
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
                                            src={
                                                chainId && currentUser
                                                    ? generateAvatar(
                                                          chainId,
                                                          currentUser,
                                                      )
                                                    : undefined
                                            }
                                        />
                                        <AvatarFallback className="rounded-lg">
                                            ?
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="grid flex-1 text-left text-sm leading-tight">
                                        <span className="truncate font-semibold">
                                            {currentUser || "Not logged in"}
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
                                        <DropdownMenuSubTrigger
                                            disabled={isLoading}
                                        >
                                            <UserPlus className="mr-2 h-4 w-4" />
                                            <span
                                                className={cn({
                                                    italic: isLoading,
                                                })}
                                            >
                                                {currentUser
                                                    ? "Switch account"
                                                    : "Select account"}
                                            </span>
                                        </DropdownMenuSubTrigger>
                                        <DropdownMenuPortal>
                                            <DropdownMenuSubContent>
                                                {connectedAccounts.map(
                                                    (connectedAccount) => (
                                                        <DropdownMenuItem
                                                            disabled={
                                                                isConnectingToAccount
                                                            }
                                                            key={
                                                                connectedAccount
                                                            }
                                                            onClick={() =>
                                                                connectToAccount(
                                                                    connectedAccount,
                                                                )
                                                            }
                                                        >
                                                            <img
                                                                className="mr-2 h-4 w-4 rounded-none"
                                                                src={createIdenticon(
                                                                    chainId +
                                                                        connectedAccount,
                                                                )}
                                                            />
                                                            <span>
                                                                {
                                                                    connectedAccount
                                                                }
                                                            </span>
                                                        </DropdownMenuItem>
                                                    ),
                                                )}
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
                                            <DropdownMenuItem
                                                onClick={() =>
                                                    setTheme("light")
                                                }
                                            >
                                                <Sun className="mr-2 h-4 w-4" />
                                                <span>Light</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onClick={() => setTheme("dark")}
                                            >
                                                <Moon className="mr-2 h-4 w-4" />
                                                <span>Dark</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                onClick={() =>
                                                    setTheme("system")
                                                }
                                            >
                                                <Sun className="mr-2 h-4 w-4" />
                                                <span>System</span>
                                            </DropdownMenuItem>
                                        </DropdownMenuSubContent>
                                    </DropdownMenuPortal>
                                </DropdownMenuSub>
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <DialogTrigger asChild>
                                <DropdownMenuItem
                                    disabled={!currentUser}
                                    onClick={() => {
                                        generateInvite.mutate();
                                    }}
                                >
                                    <User className="mr-2 h-4 w-4" />
                                    Create invite
                                </DropdownMenuItem>
                            </DialogTrigger>

                            <DropdownMenuItem
                                disabled={!canExportAccount}
                                onClick={() => {
                                    window.location.href = siblingUrl(
                                        undefined,
                                        "auth-sig",
                                        undefined,
                                        false,
                                    );
                                }}
                            >
                                <Download className="mr-2 h-4 w-4" />
                                Export account
                            </DropdownMenuItem>

                            {currentUser && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onClick={() => onLogout()}
                                    >
                                        <LogOut className="mr-2 h-4 w-4" />
                                        Log out
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </SidebarMenuItem>
            </SidebarMenu>
        </Dialog>
    );
}

const InviteDialogContent = ({
    generateInvite,
}: {
    generateInvite: UseMutationResult<string, Error, void, unknown>;
}) => {
    const onCopyClick = async () => {
        if (!generateInvite.data) {
            toast("No invite link.");
            return;
        }
        if ("clipboard" in navigator) {
            await navigator.clipboard.writeText(generateInvite.data);
            toast("Copied to clipboard.");
        } else {
            toast("Copying failed, not in secure context?");
            generateInvite.mutate();
        }
    };

    return (
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>Share link</DialogTitle>
                <DialogDescription>
                    Anyone who has this link will be able to create an account.
                </DialogDescription>
            </DialogHeader>
            <div className="flex items-center space-x-2">
                <div className="grid flex-1 gap-2">
                    <Label htmlFor="link" className="sr-only">
                        Link
                    </Label>
                    <Input
                        id="link"
                        className={cn({ italic: generateInvite.isPending })}
                        value={generateInvite.data || "Loading"}
                        readOnly
                    />
                </div>
                <Button
                    type="submit"
                    size="sm"
                    className="px-3"
                    onClick={() => onCopyClick()}
                >
                    <span className="sr-only">Copy</span>
                    <Copy className="h-4 w-4" />
                </Button>
                <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    className="px-3"
                    onClick={() => generateInvite.mutate()}
                >
                    <span className="sr-only">Refresh</span>
                    <RefreshCcw className="h-4 w-4" />
                </Button>
            </div>
            <DialogFooter className="sm:justify-start">
                <DialogClose asChild>
                    <Button type="button" variant="secondary">
                        Close
                    </Button>
                </DialogClose>
                {generateInvite.error && (
                    <div className="text-destructive">
                        {generateInvite.error.message}
                    </div>
                )}
            </DialogFooter>
        </DialogContent>
    );
};
