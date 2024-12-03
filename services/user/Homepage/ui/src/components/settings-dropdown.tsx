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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "./mode-toggle";

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
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { useSupervisor } from "@/lib/hooks/useSupervisor";
import { useLoggedInUser } from "@/lib/hooks/useLoggedInUser";
import { useCurrentAccounts } from "@/lib/hooks/useCurrentAccounts";
import { useLogout } from "@/lib/hooks/useLogout";
import { useSelectAccount } from "@/lib/hooks/useSelectAccount";
import { useGenerateInvite } from "@/lib/hooks/useGenerateInvite";
import { useCreateConnectionToken } from "@/lib/hooks/useCreateConnectionToken";

export const SettingsDropdown = () => {
    const {
        data: inviteLink,
        isPending,
        mutate: generateInvite,
    } = useGenerateInvite();

    const { mutateAsync: onLogin } = useCreateConnectionToken();

    const { isSuccess: isSupervisorLoaded } = useSupervisor();
    const { data: loggedInUser } = useLoggedInUser(isSupervisorLoaded);
    const isLoggedIn = !!loggedInUser;

    const { data: currentAccounts, isPending: isLoadingAccounts } =
        useCurrentAccounts(isSupervisorLoaded);

    const isNoOptions = !isLoggedIn && currentAccounts.length == 0;

    const { mutateAsync: onLogout } = useLogout();
    const { mutateAsync: selectAccount } = useSelectAccount();

    const onCopyClick = async () => {
        if (!inviteLink) {
            toast("No invite link.");
            return;
        }
        if ("clipboard" in navigator) {
            await navigator.clipboard.writeText(inviteLink);
            toast("Copied to clipboard.");
        } else {
            toast("Copying failed, not in secure context?");
            generateInvite();
        }
    };

    return (
        <Dialog>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Share link</DialogTitle>
                    <DialogDescription>
                        Anyone who has this link will be able to create an
                        account.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex items-center space-x-2">
                    <div className="grid flex-1 gap-2">
                        <Label htmlFor="link" className="sr-only">
                            Link
                        </Label>
                        <Input
                            id="link"
                            className={cn({ italic: isPending })}
                            value={inviteLink || "Loading"}
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
                        onClick={() => generateInvite()}
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
                </DialogFooter>
            </DialogContent>

            <ModeToggle />

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost">
                        <Settings className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                    <DropdownMenuLabel>Settings</DropdownMenuLabel>

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
                    <DropdownMenuSeparator />
                    <DialogTrigger asChild>
                        <DropdownMenuItem
                            disabled={!loggedInUser}
                            onClick={() => {
                                generateInvite();
                            }}
                        >
                            <User className="mr-2 h-4 w-4" />
                            <span>
                                Create invite
                                {!isLoggedIn && " (Requires login)"}
                            </span>
                        </DropdownMenuItem>
                    </DialogTrigger>
                    <DropdownMenuSeparator />
                    {isNoOptions && (
                        <DropdownMenuItem
                            onClick={() => {
                                onLogin();
                            }}
                        >
                            <LogIn className="mr-2 h-4 w-4" />
                            <span>
                                {isLoadingAccounts ? "Loading..." : "Login"}
                            </span>
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuGroup>
                        {!isNoOptions && (
                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                    <UserPlus className="mr-2 h-4 w-4" />
                                    <span>
                                        {loggedInUser || "Select an account"}
                                    </span>
                                </DropdownMenuSubTrigger>
                                <DropdownMenuPortal>
                                    <DropdownMenuSubContent>
                                        {currentAccounts
                                            .filter(
                                                (account) =>
                                                    account !== loggedInUser
                                            )
                                            .map((account) => (
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
                                        <DropdownMenuSeparator />
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
                        )}
                    </DropdownMenuGroup>
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
        </Dialog>
    );
};
