import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ContactForm } from "./contact-form";
import { useCreateContact } from "../hooks/useCreateContact";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { z } from "zod";
import { Account } from "@/lib/zod/Account";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onNewAccount: (account: z.infer<typeof Account>) => void;
}

export const NewContactDialog = ({
    open,
    onOpenChange,
    onNewAccount,
}: Props) => {
    const { data: currentUser } = useCurrentUser();
    const { mutateAsync: createContact } = useCreateContact(currentUser);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create contact</DialogTitle>
                    <DialogDescription className="mt-2">
                        These details are stored locally and not sent to the
                        network.
                        <ContactForm
                            onSubmit={async (data) => {
                                await createContact(data);
                                onOpenChange(false);
                                onNewAccount(data.account);
                            }}
                        />
                    </DialogDescription>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
