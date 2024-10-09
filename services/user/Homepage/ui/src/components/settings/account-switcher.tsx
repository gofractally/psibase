import { Button } from "@shadcn/button";

import { useUser } from "@/hooks";
import { ChevronRight, SettingsIcon } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@shadcn/dropdown-menu";

export function AccountSwitcher() {
    const { availableAccounts, user, setUser } = useUser();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button className="flex justify-between">
                    <div>Switch accounts </div>
                    <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end">
                <DropdownMenuRadioGroup value={user} onValueChange={setUser}>
                    {availableAccounts.map((account) => (
                        <DropdownMenuRadioItem
                            key={`switch-account-to-${account}`}
                            value={account}
                        >
                            {account}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                    <SettingsIcon size={16} className="mr-2" />
                    Manage accounts
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
