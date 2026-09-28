import { LocalContact } from "../types";
import { ContactItem } from "./contact-list-item";

export const ContactListSection = ({
    setSelectedContact,
    selectedContactId,
    contacts,
    title,
}: {
    setSelectedContact: (account: string) => void;
    selectedContactId: string | undefined;
    contacts: LocalContact[];
    title: string;
}) => {
    return (
        <section className="flex flex-col">
            <div className="bg-sidebar/80 text-muted-foreground sticky top-0 z-10 border-b px-4 py-1 text-[11px] font-medium uppercase tracking-wider backdrop-blur">
                {title}
            </div>
            <ul className="divide-border divide-y">
                {contacts.map((contact) => (
                    <ContactItem
                        key={contact.account}
                        contact={contact}
                        isSelected={selectedContactId === contact.account}
                        onSelect={() => setSelectedContact(contact.account)}
                    />
                ))}
            </ul>
        </section>
    );
};
