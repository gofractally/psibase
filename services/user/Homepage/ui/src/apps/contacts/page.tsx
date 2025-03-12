import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useContacts } from "./hooks/useContacts";
import { useDeleteContact } from "./hooks/useDeleteContact";
import { useUpdateContact } from "./hooks/useUpdateContact";
import { Plus } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { createIdenticon } from "@/lib/createIdenticon";
import { toast } from "sonner";
import { useMediaQuery } from "usehooks-ts";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ContactDetails } from "./components/contact-details";
import { NewContactDialog } from "./components/new-contact-dialog";
interface Contact {
    account: string;
    displayName: string;
    jobTitle: string;
    company: string;
    avatarUrl: string | undefined;
    email: string;
    phone: string;
}

const ContactListSection = ({
    setSelectedContact,
    selectedContactId,
    contacts,
    letter,
}: {
    setSelectedContact: (account: string) => void;
    selectedContactId: string | undefined;
    contacts: Contact[];
    letter: string;
}) => {
    return (
        <div className="flex flex-col gap-2 p-4">
            <div className="text-sm text-muted-foreground">{letter}</div>
            {contacts.map((contact) => (
                <div
                    key={contact.account}
                    onClick={() => {
                        setSelectedContact(contact.account);
                    }}
                    className={cn(
                        "flex w-full cursor-pointer justify-between rounded-sm border p-4",
                        {
                            "bg-muted": selectedContactId === contact.account,
                        },
                    )}
                >
                    <div className="flex items-center gap-2">
                        <Avatar
                            className={cn(!contact.avatarUrl && "rounded-none")}
                        >
                            <AvatarImage
                                src={
                                    contact?.avatarUrl ??
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
                            <p className="text-md font-medium">
                                {contact.displayName}
                            </p>
                            <p className="text-sm text-muted-foreground">
                                {contact.jobTitle}
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-col justify-center">
                        <div>
                            <p className="text-right text-xs text-muted-foreground">
                                {contact.account}
                            </p>
                            <p className="text-right text-xs text-muted-foreground">
                                {contact.email}
                            </p>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

export const ContactsPage = () => {
    const { data: currentUser, isLoading: isLoadingUser } = useCurrentUser();
    const { data: contactsData, isLoading: isLoadingContacts } =
        useContacts(currentUser);
    const contacts = contactsData ?? [];

    const updateContact = useUpdateContact();
    const deleteContact = useDeleteContact();

    const [newContactModal, setNewContactModal] = useState(false);

    const [selectedContactId, setSelectedContact] = useState<string>();

    const [editingContact, setEditingContactName] = useState<string>();

    const isDesktop = useMediaQuery("(min-width: 1024px)");

    const setEditingContact = (contact: string | undefined) => {
        toast.error("Not implemented: Editing contact");

        setEditingContactName(contact);
    };

    const handleTransferFunds = (contact: string | undefined) => {
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

    const selectedContact = contacts.find(
        (contact) => contact.account === selectedContactId,
    );

    const sectionsLetters = [
        ...new Set(contacts.map((contact) => contact.displayName.charAt(0))),
    ];

    const sections = sectionsLetters
        .map((letter) => ({
            letter,
            contacts: contacts.filter(
                (contact) => contact.displayName.charAt(0) === letter,
            ),
        }))
        .sort((a, b) => a.letter.localeCompare(b.letter));

    const openModal = !!(!isDesktop && selectedContactId);

    if (isLoadingUser || isLoadingContacts) {
        return <div>Loading...</div>;
    }

    if (currentUser === null) {
        return <div>Login to continue</div>;
    }

    return (
        <div className="mx-auto grid h-full w-full grid-cols-1 overflow-auto lg:grid-cols-2">
            <NewContactDialog
                open={newContactModal}
                onOpenChange={setNewContactModal}
            />

            <div className="overflow-y-auto">
                <div className="flex items-center justify-between px-2">
                    <div className="text-lg font-medium">Contacts</div>
                    <div className="flex items-center gap-2">
                        <Button onClick={() => setNewContactModal(true)}>
                            Create contact
                            <Plus />
                        </Button>
                    </div>
                </div>
                {contacts.length === 0 && (
                    <div className="flex h-full items-center justify-center">
                        <p className="text-muted-foreground">
                            No contacts. Create one!
                        </p>
                    </div>
                )}
                <div className="overflow-y-auto">
                    {sections.map((section) => (
                        <ContactListSection
                            key={section.letter}
                            letter={section.letter}
                            setSelectedContact={setSelectedContact}
                            selectedContactId={selectedContactId}
                            contacts={section.contacts}
                        />
                    ))}
                </div>
            </div>

            <Dialog
                open={openModal}
                onOpenChange={(e) => {
                    if (!e) {
                        setSelectedContact(undefined);
                    }
                }}
            >
                <DialogContent className="w-full max-w-screen-2xl">
                    <ContactDetails
                        contact={selectedContact}
                        onTransferFunds={handleTransferFunds}
                        onEditContact={setEditingContact}
                        onChainMailUser={chainMailUser}
                    />
                </DialogContent>
            </Dialog>

            {isDesktop && (
                <ContactDetails
                    contact={selectedContact}
                    onTransferFunds={handleTransferFunds}
                    onEditContact={setEditingContact}
                    onChainMailUser={chainMailUser}
                />
            )}
        </div>
    );
};
