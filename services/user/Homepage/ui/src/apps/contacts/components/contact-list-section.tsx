import { LocalContactType } from "../types";
import { ContactItem } from "./contact-list-item";

export const ContactListSection = ({
    setSelectedContact,
    selectedContactId,
    contacts,
    letter,
}: {
    setSelectedContact: (account: string) => void;
    selectedContactId: string | undefined;
    contacts: LocalContactType[];
    letter: string;
}) => {
    return (
        <div className="flex flex-col gap-2 px-4 py-2">
            <div className="text-sm text-muted-foreground">
                {letter.toUpperCase()}
            </div>
            {contacts.map((contact) => (
                <ContactItem
                    key={contact.account}
                    contact={contact}
                    isSelected={selectedContactId === contact.account}
                    onSelect={() => setSelectedContact(contact.account)}
                />
            ))}
        </div>
    );
};
