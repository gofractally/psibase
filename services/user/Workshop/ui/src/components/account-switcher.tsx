import { useUser } from "@hooks";
import { cn } from "@lib/utils";
import { accounts } from "src/fixtures/data";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shadcn/select";

interface AccountSwitcherProps {
    isCollapsed: boolean;
}

export function AccountSwitcher({ isCollapsed }: AccountSwitcherProps) {
    const [selectedAccount, setSelectedAccount] = useUser();

    return (
        <Select
            defaultValue={selectedAccount.account}
            onValueChange={(value) => {
                setSelectedAccount(
                    accounts.find((acct) => acct.account === value) ??
                        accounts[0],
                );
            }}
        >
            <SelectTrigger
                className={cn(
                    "flex items-center gap-2 [&>span]:line-clamp-1 [&>span]:flex [&>span]:w-full [&>span]:items-center [&>span]:gap-1 [&>span]:truncate [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
                    isCollapsed &&
                        "flex h-9 w-9 shrink-0 items-center justify-center p-0 [&>span]:w-auto [&>svg]:hidden",
                )}
                aria-label="Select account"
            >
                <SelectValue placeholder="Select an account">
                    <span className={cn("ml-2", isCollapsed && "hidden")}>
                        {selectedAccount.name}
                    </span>
                </SelectValue>
            </SelectTrigger>
            <SelectContent>
                {accounts.map((account) => (
                    <SelectItem key={account.account} value={account.account}>
                        <div className="flex items-center gap-3 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:text-foreground">
                            {account.account}
                        </div>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
