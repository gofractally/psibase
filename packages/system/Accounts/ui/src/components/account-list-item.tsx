import { LogOut } from "lucide-react";

import { Avatar } from "@shared/components/avatar";
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
}

export const AccountListItem = ({ name, onLogin, onRemove }: Props) => {
    return (
        <li className="hover:bg-sidebar-accent flex select-none items-center rounded-md px-2 py-4">
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
                        variant="outline"
                        size="icon"
                        className="cursor-pointer"
                    >
                        <LogOut />
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
