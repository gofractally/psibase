import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createIdenticon } from "@/lib/createIdenticon";
import { Edit, Mail, Phone, Wallet } from "lucide-react";

export interface Contact {
    account: string;
    displayName: string;
    jobTitle: string;
    company: string;
    avatarUrl: string | undefined;
    email: string;
    phone: string;
}

interface ContactDetailsProps {
    contact: Contact | undefined;
    onTransferFunds: (contactId: string) => void;
    onEditContact: (contactId: string) => void;
    onChainMailUser: (contactId: string) => void;
}

export function ContactDetails({
    contact,
    onTransferFunds,
    onEditContact,
    onChainMailUser,
}: ContactDetailsProps) {
    if (!contact) {
        return (
            <div className="flex h-full items-center justify-center">
                Select a contact to view details
            </div>
        );
    }

    return (
        <div>
            <div className="mx-auto flex w-full flex-col items-center justify-center gap-4 p-4 sm:flex-row">
                <Avatar
                    className={cn(
                        "h-36 w-36",
                        !contact.avatarUrl && "rounded-none",
                    )}
                >
                    <AvatarImage
                        src={
                            contact.avatarUrl ??
                            createIdenticon(contact.account)
                        }
                    />
                    <AvatarFallback>
                        {contact.displayName.charAt(0)}
                    </AvatarFallback>
                </Avatar>
                <div className="flex w-72 flex-col gap-2 text-center sm:text-left">
                    <div className="text-lg font-medium">
                        {contact.displayName}
                    </div>
                    <div className="flex flex-col gap-1">
                        <div className="text-sm text-muted-foreground">
                            @{contact.account}
                        </div>
                        <div className="text-sm text-muted-foreground">
                            {contact.jobTitle}
                        </div>
                    </div>
                    <div className="flex w-full justify-center gap-2 text-muted-foreground sm:justify-start">
                        <Button
                            onClick={() => onTransferFunds(contact.account)}
                            size="icon"
                            variant="outline"
                            className="hover:text-primary"
                        >
                            <Wallet />
                        </Button>
                        <Button
                            onClick={() => onEditContact(contact.account)}
                            size="icon"
                            variant="outline"
                            className="hover:text-primary"
                        >
                            <Edit />
                        </Button>
                        <Button
                            onClick={() => onChainMailUser(contact.account)}
                            size="icon"
                            variant="outline"
                            className="hover:text-primary"
                        >
                            <Mail />
                        </Button>
                    </div>
                </div>
            </div>
            <div className="mx-auto grid max-w-screen-md grid-cols-1 gap-3 p-4 sm:grid-cols-2">
                <div className="flex items-center gap-2 rounded-sm bg-muted p-3">
                    <Phone />
                    {contact.phone}
                </div>
                <div className="flex items-center gap-2 rounded-sm bg-muted p-3">
                    <Mail />
                    {contact.email}
                </div>
            </div>
        </div>
    );
}
