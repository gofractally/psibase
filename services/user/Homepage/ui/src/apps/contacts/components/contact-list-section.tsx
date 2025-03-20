import { LocalContactType } from "../types";
import { ContactItem } from "./contact-list-item";

export const ContactListSection = ({
    setSelectedContact,
    selectedContactId,
    contacts,
    title,
}: {
    setSelectedContact: (account: string) => void;
    selectedContactId: string | undefined;
    contacts: LocalContactType[];
    title: string;
}) => {
    return (
        <div className="flex flex-col gap-2 px-4 py-2">
            <div className="text-sm text-muted-foreground">{title}</div>
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
