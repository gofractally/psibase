import {
    Settings,
    Github,
    LifeBuoy,
    LogOut,
    PlusCircle,
    User,
    UserPlus,
    Copy,
    RefreshCcw,
    LogIn,
    Download,
} from "lucide-react";
import { toast } from "sonner";
import { type UseMutationResult } from "@tanstack/react-query";

import { siblingUrl } from "@psibase/common-lib";

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
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLogout } from "@/hooks/useLogout";
import { useSelectAccount } from "@/hooks/useSelectAccount";
import { useGenerateInvite } from "@/hooks/useGenerateInvite";
import { useCreateConnectionToken } from "@/hooks/useCreateConnectionToken";

import { ModeToggle } from "./mode-toggle";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { useCanExportAccount } from "@/hooks/useCanExportAccount";
import { useConnectedAccounts } from "@/hooks/useConnectedAccounts";

export const SettingsDropdown = () => {
    const generateInvite = useGenerateInvite();

    const { mutateAsync: onLogin } = useCreateConnectionToken();

    const { data: currentUser } = useCurrentUser();
    const isLoggedIn = !!currentUser;

    const { data: connectedAccountsData, isPending: isLoadingAccounts } =
        useConnectedAccounts();


    const connectedAccounts = connectedAccountsData || [];
    const isNoOptions = !isLoggedIn && connectedAccounts.length == 0;

    const { mutateAsync: onLogout } = useLogout();
    const { mutateAsync: selectAccount } = useSelectAccount();

    const otherConnectedAccounts = connectedAccounts.filter(
        (account) => account !== currentUser,
    );

    const { data: canExportAccount } = useCanExportAccount(currentUser);

    return (
        <Dialog>
            <InviteDialogContent generateInvite={generateInvite} />
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon">
                        <Settings className="h-[1.2rem] w-[1.2rem]" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                    <DropdownMenuLabel>
                        {currentUser || "Not logged in"}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
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
                                        {otherConnectedAccounts.map(
                                            (account) => (
                                                <DropdownMenuItem
                                                    key={account}
                                                    onClick={() => {
                                                        selectAccount(account);
                                                    }}
                                                >
                                                    <User className="mr-2 h-4 w-4" />
                                                    <span>{account}</span>
                                                </DropdownMenuItem>
                                            ),
                                        )}
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
                    {canExportAccount ? (
                        <a
                            href={siblingUrl(
                                undefined,
                                "auth-sig",
                                undefined,
                                false,
                            )}
                        >
                            <DropdownMenuItem>
                                <Download className="mr-2 h-4 w-4" />
                                Export account
                            </DropdownMenuItem>
                        </a>
                    ) : null}
                    <DropdownMenuSeparator />

                    <ModeToggle />

                    <DropdownMenuSeparator />
                    <a
                        href="https://github.com/gofractally/psibase"
                        target="_blank"
                        rel="noreferrer"
                    >
                        <DropdownMenuItem>
                            <Github className="mr-2 h-4 w-4" />
                            <span>GitHub</span>
                        </DropdownMenuItem>
                    </a>
                    <a
                        href="https://t.me/psibase_developers"
                        target="_blank"
                        rel="noreferrer"
                    >
                        <DropdownMenuItem>
                            <LifeBuoy className="mr-2 h-4 w-4" />
                            <span>Support</span>
                        </DropdownMenuItem>
                    </a>
                </DropdownMenuContent>
            </DropdownMenu>
        </Dialog>
    );
};

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
