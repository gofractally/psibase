import { z } from "zod";

import { Account } from "@/lib/zod/Account";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

import { useCreateContact } from "../hooks/use-create-contact";
import { ContactForm } from "./contact-form";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onNewAccount: (account: z.infer<typeof Account>) => void;
    trigger: React.ReactNode;
}

export const NewContactDialog = ({
    open,
    onOpenChange,
    onNewAccount,
    trigger,
}: Props) => {
    const { mutateAsync: createContact } = useCreateContact();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {trigger}
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
