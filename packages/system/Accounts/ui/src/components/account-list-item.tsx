import { X } from "lucide-react";

import { Avatar } from "@shared/components/avatar";
import { cn } from "@shared/lib/utils";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@shared/shadcn/ui/alert-dialog";
import { Button } from "@shared/shadcn/ui/button";

interface Props {
    name: string;
    onLogin: () => void;
    onRemove: () => void;
    canLogin?: boolean;
}

export const AccountListItem = ({
    name,
    onLogin,
    onRemove,
    canLogin = false,
}: Props) => {
    return (
        <li
            className={cn(
                "flex select-none items-center rounded-md px-2 py-4",
                canLogin && "hover:bg-sidebar-accent",
            )}
        >
            <button
                onClick={onLogin}
                className="flex flex-1 items-center gap-2"
            >
                <Avatar account={name} className="size-6" />
                {name}
            </button>
            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="cursor-pointer"
                    >
                        <X />
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove account?</AlertDialogTitle>
                    </AlertDialogHeader>
                    <AlertDialogDescription>
                        This will remove the account{" "}
                        <span className="text-primary">{name}</span> from this
                        browser and will sign it out of any connected apps.
                    </AlertDialogDescription>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={onRemove}>
                            Remove
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </li>
    );
};
