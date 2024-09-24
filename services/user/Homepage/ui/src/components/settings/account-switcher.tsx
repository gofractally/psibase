import { useUser } from "@hooks";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shadcn/select";

export function AccountSwitcher() {
    const { availableAccounts, user, setUser } = useUser();

    return (
        <Select
            defaultValue={user}
            onValueChange={(value) => {
                setUser(value);
            }}
        >
            <SelectTrigger
                className="flex items-center gap-2 [&>span]:line-clamp-1 [&>span]:flex [&>span]:w-full [&>span]:items-center [&>span]:gap-1 [&>span]:truncate [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0"
                aria-label="Select account"
            >
                <SelectValue placeholder="Select an account">
                    <span className="ml-2">{user}</span>
                </SelectValue>
            </SelectTrigger>
            <SelectContent>
                {availableAccounts.map((account) => (
                    <SelectItem key={account} value={account}>
                        <div className="flex items-center gap-3 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:text-foreground">
                            {account}
                        </div>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
