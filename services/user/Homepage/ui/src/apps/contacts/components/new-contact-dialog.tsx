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

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export const NewContactDialog = ({ open, onOpenChange }: Props) => {
    const { data: currentUser } = useCurrentUser();
    const { mutateAsync: createContact } = useCreateContact(currentUser);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create contact</DialogTitle>
                    <DialogDescription className="mt-2">
                        <ContactForm
                            onSubmit={async (data) => {
                                await createContact(data);
                                onOpenChange(false);
                            }}
                        />
                    </DialogDescription>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
};
