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
    CreditCard,
    Github,
    LifeBuoy,
    LogOut,
    Mail,
    MessageSquare,
    PlusCircle,
    User,
    UserPlus,
    Copy,
    RefreshCcw,
    LogIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "./mode-toggle";
import { useEffect, useState } from "react";

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
import { useMutation, useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { siblingUrl, Supervisor } from "@psibase/common-lib";
import { useNavigate } from "react-router-dom";
import { modifyUrlParams } from "@/lib/modifyUrlParams";
import { z } from "zod";
import { supervisor } from "@/main";

const wait = (ms = 1000) => new Promise((resolve) => setTimeout(resolve, ms));

const createConnectionToken = async (): Promise<string> => {
    const token = z.string().parse(
        await supervisor.functionCall({
            method: "createConnectionToken",
            params: [],
            service: "accounts",
            intf: "activeApp",
        })
    );

    return token;
};

const fetchInvite = async (): Promise<string> => {
    await wait(2000);

    try {
        const token = z.string().parse(
            await supervisor.functionCall({
                service: "invite",
                intf: "inviter",
                method: "generateInvite",
                params: ["/thisismycallback?params=derp"],
            })
        );

        console.log(token, "is invite res");

        const res = modifyUrlParams(
            siblingUrl(undefined, "accounts", null, false),
            {
                token,
                invite: "1",
            }
        );

        console.log({ res });

        return res as string;
    } catch (e) {
        console.error(e);
        throw new Error("got no string");
    }
};

export const SettingsDropdown = () => {
    const navigate = useNavigate();

    const {
        data: inviteLink,
        isPending,
        mutate: generateInvite,
    } = useMutation({
        mutationFn: fetchInvite,
    });

    const [activeUser, setActiveUser] = useState<string>("");

    const { mutateAsync: onLogin } = useMutation({
        mutationFn: createConnectionToken,
        onSuccess: (token) => {
            const url = modifyUrlParams(
                siblingUrl(undefined, "accounts", null, false),
                {
                    token,
                }
            );

            console.log(url, "is the url I want to use");

            window.location.href = url;
        },
    });

    const { isSuccess: isLoaded } = useQuery({
        queryKey: ["loaded"],
        queryFn: async () => {
            await supervisor.onLoaded();
            supervisor.preLoadPlugins([{ service: "accounts" }]);
        },
    });

    const { data: loggedInUser, refetch: refetchLoggedInUser } = useQuery({
        queryKey: ["loggedInUser"],
        enabled: isLoaded,
        queryFn: async () => {
            return z
                .string()
                .optional()
                .parse(
                    await supervisor.functionCall({
                        method: "getLoggedInUser",
                        params: [],
                        service: "accounts",
                        intf: "activeApp",
                    })
                );
        },
    });

    const isLoggedIn = !!loggedInUser;

    const { data: currentAccounts, refetch: refetchCurrentAccounts } = useQuery(
        {
            queryKey: ["currentAccounts"],
            enabled: isLoaded,
            initialData: [],
            queryFn: async () => {
                return z
                    .string()
                    .array()
                    .parse(
                        await supervisor.functionCall({
                            method: "getConnectedAccounts",
                            params: [],
                            service: "accounts",
                            intf: "activeApp",
                        })
                    );
            },
        }
    );

    const selectAccount = async (accountName: string) => {
        void (await supervisor.functionCall({
            method: "login",
            params: [z.string().parse(accountName)],
            service: "accounts",
            intf: "activeApp",
        }));
    };

    const init = async () => {
        const res = z
            .string()
            .array()
            .parse(
                await supervisor.functionCall({
                    method: "getConnectedAccounts",
                    params: [],
                    service: "accounts",
                    intf: "activeApp",
                })
            );
        console.log(res, "was the accounts return");

        try {
            void (await supervisor.functionCall({
                method: "login",
                params: ["aa"],
                service: "accounts",
                intf: "activeApp",
            }));
        } catch (e) {
            console.error("there was an error hitting login", e);
        }

        const res3 = await supervisor.functionCall({
            method: "getLoggedInUser",
            params: [],
            service: "accounts",
            intf: "activeApp",
        });

        console.log({ res3 });
    };

    useEffect(() => {
        init();
    }, []);

    const onCopyClick = async () => {
        navigate("invite");
        if ("clipboard" in navigator) {
            await navigator.clipboard.writeText("test");
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
                    <DropdownMenuItem
                        onClick={() => {
                            onLogin();
                        }}
                    >
                        <LogIn className="mr-2 h-4 w-4" />
                        <span>{loggedInUser || "Select account"}</span>
                    </DropdownMenuItem>
                    <DropdownMenuGroup>
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                                <UserPlus className="mr-2 h-4 w-4" />
                                <span>{currentAccounts}</span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuPortal>
                                <DropdownMenuSubContent>
                                    {currentAccounts.map((account) => (
                                        <DropdownMenuItem key={account}>
                                            <Mail className="mr-2 h-4 w-4" />
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
                        <DialogTrigger asChild>
                            <DropdownMenuItem
                                disabled={!activeUser}
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
                        <DropdownMenuItem disabled>
                            <CreditCard className="mr-2 h-4 w-4" />
                            <span>Billing</span>
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                    {false && (
                        <DropdownMenuGroup>
                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                    <UserPlus className="mr-2 h-4 w-4" />
                                    <span>Invite users</span>
                                </DropdownMenuSubTrigger>
                                <DropdownMenuPortal>
                                    <DropdownMenuSubContent>
                                        <DropdownMenuItem>
                                            <Mail className="mr-2 h-4 w-4" />
                                            <span>Email</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem>
                                            <MessageSquare className="mr-2 h-4 w-4" />
                                            <span>Message</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem>
                                            <PlusCircle className="mr-2 h-4 w-4" />
                                            <span>More...</span>
                                        </DropdownMenuItem>
                                    </DropdownMenuSubContent>
                                </DropdownMenuPortal>
                            </DropdownMenuSub>
                        </DropdownMenuGroup>
                    )}
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
                    <DropdownMenuItem disabled>
                        <LogOut className="mr-2 h-4 w-4" />
                        <span>Log out</span>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </Dialog>
    );
};
