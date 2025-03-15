import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Edit, Mail, Phone, Wallet } from "lucide-react";
import { useAvatar } from "@/hooks/useAvatar";

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
    onBack?: () => void;
}

export function ContactDetails({
    contact,
    onTransferFunds,
    onEditContact,
    onChainMailUser,
    onBack,
}: ContactDetailsProps) {
    if (!contact) {
        return (
            <div className="flex h-full items-center justify-center">
                Select a contact to view details
            </div>
        );
    }

    const avatarSrc = useAvatar(contact.account);

    return (
        <div>
            {onBack && (
                <div className="pl-4">
                    <Button onClick={onBack} variant="outline" size="icon">
                        <ArrowLeft />
                    </Button>
                </div>
            )}
            <div className="mx-auto flex w-full flex-col items-center justify-center gap-4 p-4 sm:flex-row">
                <Avatar className="h-32 w-32 rounded-none">
                    <AvatarImage src={avatarSrc} />
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
                            @{contact.account.toLowerCase()}
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
                {contact.phone && (
                    <div className="flex items-center gap-2 truncate  rounded-sm bg-muted p-3">
                        <Phone />
                        {contact.phone}
                    </div>
                )}
                {contact.email && (
                    <div className="flex items-center gap-2 truncate rounded-sm bg-muted p-3">
                        <Mail />
                        {contact.email}
                    </div>
                )}
            </div>
        </div>
    );
}
