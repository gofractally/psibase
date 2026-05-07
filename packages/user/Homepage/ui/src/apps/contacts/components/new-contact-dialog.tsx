import type { Account } from "@shared/lib/schemas/account";
import type { LocalContact } from "../types";

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
    onNewAccount?: (account: Account) => void;
    trigger?: React.ReactNode;
    initialValues?: LocalContact;
}

export const NewContactDialog = ({
    open,
    onOpenChange,
    onNewAccount,
    trigger,
    initialValues,
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
                            key={initialValues?.account ?? "new-contact"}
                            initialValues={initialValues}
                            onSubmit={async (data) => {
                                await createContact(data);
                                onOpenChange(false);
                                onNewAccount?.(data.account);
                            }}
                        />
                    </DialogDescription>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
