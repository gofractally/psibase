import {
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { AccountSwitcher } from "@/components/settings";

export const SettingsSheet = () => {
    return (
        <SheetContent className="w-full">
            <SheetHeader>
                <SheetTitle>Are you absolutely sure?</SheetTitle>
                <SheetDescription>
                    This action cannot be undone. This will permanently delete
                    your account and remove your data from our servers.
                </SheetDescription>
                <AccountSwitcher />
            </SheetHeader>
        </SheetContent>
    );
};
