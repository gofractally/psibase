import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Contact } from "./types";
import { useContacts } from "./hooks/useContacts";
import { useDeleteContact } from "./hooks/useDeleteContact";
import { useUpdateContact } from "./hooks/useUpdateContact";
import { Edit, Mail, Phone, Wallet } from "lucide-react";
import { NewContactDialog } from "./components/new-contact-dialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
    randEmail,
    randFullName,
    randJobTitle,
    randCompanyName,
    randAvatar,
    randPhoneNumber,
    randUserName,
} from "@ngneat/falso";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { createIdenticon } from "@/lib/createIdenticon";
import { toast } from "sonner";

const contacts = Array.from({ length: 30 }, () => ({
    account: randUserName(),
    displayName: randFullName(),
    jobTitle: randJobTitle(),
    company: randCompanyName(),
    avatarUrl: Math.random() > 0.5 ? randAvatar() : undefined,
    email: randEmail(),
    phone: randPhoneNumber(),
}));

export const ContactsPage = () => {
    const { data: currentUser } = useCurrentUser();
    // const { data: contacts, isLoading } = useContacts(currentUser);

    const updateContact = useUpdateContact();
    const deleteContact = useDeleteContact();

    const [newContactModal, setNewContactModal] = useState(false);

    const [selectedContactId, setSelectedContact] = useState<string>();

    const [editingContact, setEditingContactName] = useState<string>();

    const setEditingContact = (contact: string | undefined) => {
        console.log({ contact });
        toast.error("Not implemented: Editing contact");

        setEditingContactName(contact);
    };

    const handleTransferFunds = (contact: string | undefined) => {
        console.log({ contact });
        toast.error("Not implemented: Transfer funds");
    };

    const handleUpdate = (contact: Contact) => {
        updateContact.mutate(contact, {
            onSuccess: () => setEditingContact(undefined),
        });
    };

    const chainMailUser = (contactId: string) => {
        console.log({ contactId });
        toast.error("Not implemented: Chain mail user");
    };

    const handleDelete = (contact: Contact) => {
        deleteContact.mutate(contact.account, {
            onSuccess: () => setEditingContact(undefined),
        });
    };

    console.log({ handleDelete });

    console.log({ contacts }, "are the contacts");
    const selectedContact = contacts.find(
        (contact) => contact.account === selectedContactId,
    );

    return (
        <div className="mx-auto grid h-full w-full grid-cols-1 overflow-auto sm:grid-cols-2">
            <div className="flex h-full flex-col gap-2 overflow-y-auto  p-4">
                {contacts.map((contact) => (
                    <div
                        key={contact.account}
                        onClick={() => {
                            setSelectedContact(contact.account);
                        }}
                        className={cn(
                            "flex w-full cursor-pointer justify-between rounded-sm border p-4",
                            {
                                "bg-muted":
                                    selectedContactId === contact.account,
                            },
                        )}
                    >
                        <div className="flex items-center gap-2">
                            <Avatar>
                                <AvatarImage
                                    src={
                                        selectedContact?.avatarUrl ??
                                        createIdenticon(
                                            selectedContactId ?? "blank",
                                        )
                                    }
                                />
                                <AvatarFallback>
                                    {contact.displayName.charAt(0)}
                                </AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col">
                                <p className="text-sm font-medium">
                                    {contact.displayName}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {contact.jobTitle}
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-col items-end">
                            <p className="text-xs text-muted-foreground">
                                {contact.account}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {contact.email}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
            <div className="">
                <div className="mx-auto flex w-full items-center justify-center gap-4  p-4">
                    <Avatar
                        className={cn(
                            "h-36 w-36",
                            !selectedContact?.avatarUrl && "rounded-none",
                        )}
                    >
                        <AvatarImage
                            src={
                                selectedContact?.avatarUrl ??
                                createIdenticon(selectedContactId ?? "blank")
                            }
                        />
                        <AvatarFallback>
                            {selectedContact?.displayName.charAt(0)}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex w-72 flex-col gap-2">
                        <div className="text-lg font-medium">
                            {selectedContact?.displayName}
                        </div>
                        <div className="text-sm text-muted-foreground">
                            {selectedContact?.jobTitle}
                        </div>
                        <div className="flex gap-2 text-muted-foreground ">
                            <Button
                                onClick={() => {
                                    handleTransferFunds(selectedContactId);
                                }}
                                size="icon"
                                variant="outline"
                                className="hover:text-primary"
                            >
                                <Wallet />
                            </Button>
                            <Button
                                onClick={() => {
                                    setEditingContact(selectedContactId);
                                }}
                                size="icon"
                                variant="outline"
                                className="hover:text-primary"
                            >
                                <Edit />
                            </Button>
                            <Button
                                onClick={() => {
                                    chainMailUser(selectedContactId!);
                                }}
                                size="icon"
                                variant="outline"
                                className="hover:text-primary"
                            >
                                <Mail />
                            </Button>
                        </div>
                    </div>
                </div>
                <div className="mx-auto grid max-w-screen-lg grid-cols-2 gap-3 p-4">
                    <div className="flex items-center gap-2 rounded-sm bg-muted p-3">
                        <Phone />
                        {selectedContact?.phone}
                    </div>
                    <div className="flex items-center gap-2 rounded-sm bg-muted p-3">
                        <Mail />
                        {selectedContact?.email}
                    </div>
                </div>
            </div>
        </div>
    );
};
