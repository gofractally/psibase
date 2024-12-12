import {
    useCreateConnectionToken,
    useCurrentAccounts,
    useIncomingMessages,
    useLoggedInUser,
    useLogout,
    useSelectAccount,
} from "@hooks";
import { cn } from "@lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@shadcn/avatar";
import { Button } from "@shadcn/button";
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
} from "@shadcn/dropdown-menu";
import {
    ChevronsUpDown,
    LogIn,
    LogOut,
    PlusCircle,
    User,
    UserPlus,
} from "lucide-react";

interface AccountSwitcherProps {
    isCollapsed: boolean;
}

const user = {
    avatar: undefined,
    name: "alice",
};

export function AccountSwitcher({ isCollapsed }: AccountSwitcherProps) {
    const { setSelectedMessageId } = useIncomingMessages();
    // const { availableAccounts, user, setUser } = useUser();

    const { mutateAsync: onLogin } = useCreateConnectionToken();

    const { data: loggedInUser } = useLoggedInUser();
    const isLoggedIn = !!loggedInUser;

    const { data: currentAccounts, isPending: isLoadingAccounts } =
        useCurrentAccounts();

    const isNoOptions = !isLoggedIn && currentAccounts.length == 0;

    const { mutateAsync: onLogout } = useLogout();
    const { mutateAsync: selectAccount } = useSelectAccount();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    size="lg"
                    variant="ghost"
                    className={cn("w-full", !isCollapsed && "pl-1 pr-2")}
                >
                    <Avatar className="h-8 w-8 rounded-lg">
                        <AvatarImage src={user.avatar} alt={user.name} />
                        <AvatarFallback className="rounded-lg">
                            {loggedInUser ? (
                                user.name[0]
                            ) : (
                                <LogIn className="h-4 w-4" />
                            )}
                        </AvatarFallback>
                    </Avatar>
                    {isCollapsed ? null : (
                        <>
                            <div className="ml-2 grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-semibold">
                                    {loggedInUser ? user.name : "Get started"}
                                </span>
                            </div>
                            <ChevronsUpDown className="ml-auto size-4" />
                        </>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                // side={isMobile ? "bottom" : "right"}
                side="right"
                align="end"
                sideOffset={4}
            >
                {loggedInUser ? (
                    <>
                        <DropdownMenuLabel className="p-0 font-normal">
                            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                                <Avatar className="h-8 w-8 rounded-lg">
                                    <AvatarImage
                                        src={user.avatar}
                                        alt={user.name}
                                    />
                                    <AvatarFallback className="rounded-lg">
                                        {user.name[0]}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-semibold">
                                        {user.name}
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
                            {isLoadingAccounts ? "Loading..." : "Login"}
                        </span>
                    </DropdownMenuItem>
                )}
                <DropdownMenuGroup>
                    {!isNoOptions ? (
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                                <UserPlus className="mr-2 h-4 w-4" />
                                <span>
                                    {loggedInUser || "Select an account"}
                                </span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuPortal>
                                <DropdownMenuSubContent>
                                    <DropdownMenuLabel>
                                        Switch accounts
                                    </DropdownMenuLabel>
                                    {currentAccounts
                                        .filter(
                                            (account) =>
                                                account !== loggedInUser,
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
                    ) : null}
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
    );

    // return (
    //     <Select
    //         defaultValue={user}
    //         onValueChange={(value) => {
    //             setSelectedMessageId("");
    //             setUser(value);
    //         }}
    //     >
    //         <SelectTrigger
    //             className={cn(
    //                 "flex items-center gap-2 [&>span]:line-clamp-1 [&>span]:flex [&>span]:w-full [&>span]:items-center [&>span]:gap-1 [&>span]:truncate [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
    //                 isCollapsed &&
    //                     "flex h-9 w-9 shrink-0 items-center justify-center p-0 [&>span]:w-auto [&>svg]:hidden",
    //             )}
    //             aria-label="Select account"
    //         >
    //             <SelectValue placeholder="Select an account">
    //                 <span className={cn("ml-2", isCollapsed && "hidden")}>
    //                     {user}
    //                 </span>
    //             </SelectValue>
    //         </SelectTrigger>
    //         <SelectContent>
    //             {availableAccounts.map((account) => (
    //                 <SelectItem key={account} value={account}>
    //                     <div className="flex items-center gap-3 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:text-foreground">
    //                         {account}
    //                     </div>
    //                 </SelectItem>
    //             ))}
    //         </SelectContent>
    //     </Select>
    // );
}
