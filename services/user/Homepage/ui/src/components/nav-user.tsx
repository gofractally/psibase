import { type UseMutationResult } from "@tanstack/react-query";
import {
    ChevronsUpDown,
    Contact,
    Copy,
    Download,
    LogIn,
    LogOut,
    Moon,
    PlusCircle,
    RefreshCcw,
    Sun,
    User,
    UserPlus,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
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

import { useAvatar } from "@/hooks/use-avatar";
import { useCanExportAccount } from "@/hooks/use-can-export-account";
import { useChainId } from "@/hooks/use-chain-id";
import { useConnectedAccounts } from "@/hooks/use-connected-accounts";
import { useCreateConnectionToken } from "@/hooks/use-create-connection-token";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useGenerateInvite } from "@/hooks/use-generate-invite";
import { useLogout } from "@/hooks/use-logout";
import { useProfile } from "@/hooks/use-profile";
import { useSelectAccount } from "@/hooks/use-select-account";
import { cn } from "@/lib/utils";
import { Account } from "@/lib/zod/Account";

import { EditProfileDialogContent } from "@/apps/contacts/components/edit-profile-dialog";

import { useTheme } from "./theme-provider";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

function AccountMenuItem({
    account,
    isConnectingToAccount,
    connectToAccount,
}: {
    account: z.infer<typeof Account>;
    isConnectingToAccount: boolean;
    connectToAccount: (account: string) => void;
}) {
    const { avatarSrc } = useAvatar(account);

    return (
        <DropdownMenuItem
            disabled={isConnectingToAccount}
            key={account}
            onClick={() => connectToAccount(account)}
        >
            <img className="mr-2 h-4 w-4 rounded-none" src={avatarSrc} />
            <span>{account}</span>
        </DropdownMenuItem>
    );
}

export function NavUser() {
    const { isMobile } = useSidebar();

    const { data: currentUser, isFetched: isFetchedLoggedInuser } =
        useCurrentUser();

    const { isFetched: isFetchedChainId } = useChainId();
    const { mutateAsync: logout } = useLogout();
    const navigate = useNavigate();

    const { data: profile } = useProfile(currentUser);
    const { avatarSrc } = useAvatar(currentUser);

    const onLogout = async () => {
        await logout();
        navigate("/");
    };

    const [modalType, setModalType] = useState<
        "editProfile" | "generateInvite"
    >("editProfile");
    const [showModal, setShowModal] = useState(false);

    const onEditProfile = () => {
        setModalType("editProfile");
        setShowModal(true);
    };

    const { setTheme } = useTheme();

    const {
        data: connectedAccountsData,
        isFetched: isFetchedConnectedAccounts,
    } = useConnectedAccounts();

    const connectedAccounts = connectedAccountsData.filter(
        (account) => account.toLowerCase() !== currentUser?.toLowerCase(),
    );

    const { mutateAsync: login } = useCreateConnectionToken();
    const { mutateAsync: connectToAccount, isPending: isConnectingToAccount } =
        useSelectAccount();

    const generateInvite = useGenerateInvite();
    const { data: canExportAccount } = useCanExportAccount(currentUser);

    const onGenerateInvite = () => {
        generateInvite.mutate();
        setModalType("generateInvite");
        setShowModal(true);
    };

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
        <Dialog open={showModal} onOpenChange={setShowModal}>
            {modalType == "generateInvite" && (
                <InviteDialogContent generateInvite={generateInvite} />
            )}
            {modalType == "editProfile" && (
                <EditProfileDialogContent
                    onClose={() => {
                        setShowModal(false);
                    }}
                />
            )}
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
                                        className="object-cover"
                                        src={avatarSrc}
                                        alt={currentUser || ""}
                                    />
                                    <AvatarFallback className="rounded-lg">
                                        ?
                                    </AvatarFallback>
                                </Avatar>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate ">
                                        {profile?.profile?.displayName ||
                                            currentUser ||
                                            "Not logged in"}
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
                                            src={avatarSrc}
                                            className="object-cover"
                                        />
                                        <AvatarFallback className="rounded-lg">
                                            ?
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="grid flex-1 text-left text-sm leading-tight">
                                        <span className="truncate font-semibold">
                                            {profile?.profile?.displayName ||
                                                currentUser ||
                                                "Not logged in"}{" "}
                                            {profile?.profile?.displayName ? (
                                                <span className="text-xs text-muted-foreground">
                                                    {`(${currentUser})`}
                                                </span>
                                            ) : (
                                                ""
                                            )}
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
                                                        <AccountMenuItem
                                                            key={
                                                                connectedAccount
                                                            }
                                                            account={
                                                                connectedAccount
                                                            }
                                                            isConnectingToAccount={
                                                                isConnectingToAccount
                                                            }
                                                            connectToAccount={
                                                                connectToAccount
                                                            }
                                                        />
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
                            <DropdownMenuItem
                                disabled={!currentUser}
                                onClick={() => {
                                    onGenerateInvite();
                                }}
                            >
                                <User className="mr-2 h-4 w-4" />
                                Create invite
                            </DropdownMenuItem>

                            <DropdownMenuItem
                                disabled={!currentUser}
                                onClick={() => {
                                    onEditProfile();
                                }}
                            >
                                <Contact className="mr-2 h-4 w-4" />
                                Edit profile
                            </DropdownMenuItem>

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
