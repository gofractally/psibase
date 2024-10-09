import {
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@shadcn/sheet";
import { Avatar, AvatarFallback } from "@shadcn/avatar";

import { AccountSwitcher } from "@/components/settings";
import { useUser } from "@/hooks";

export const SettingsSheet = () => {
    const { availableAccounts, user, setUser } = useUser();
    return (
        <SheetContent className="w-full p-0">
            <div className="h-28 w-full bg-gradient-to-br from-violet-500 to-fuchsia-500"></div>
            {user ? (
                <div className="-mt-[45px] ml-4 flex h-[90px] w-[90px] items-center justify-center rounded-full bg-background">
                    <Avatar className="h-20 w-20 select-none">
                        <AvatarFallback className="bg-gray-300 text-3xl font-medium text-gray-800">
                            {user[0].toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                </div>
            ) : null}
            <SheetHeader className="p-4">
                <SheetTitle>{user}</SheetTitle>
                {/* <SheetDescription>
                    This action cannot be undone. This will permanently delete
                    your account and remove your data from our servers.
                </SheetDescription> */}
                <AccountSwitcher />
            </SheetHeader>
        </SheetContent>
    );
};
