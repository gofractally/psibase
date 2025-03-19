import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useContacts } from "./hooks/useContacts";
import { Plus, Search } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { toast } from "sonner";
import { useMediaQuery } from "usehooks-ts";
import { ContactDetails } from "./components/contact-details";
import { NewContactDialog } from "./components/new-contact-dialog";
import { Input } from "@/components/ui/input";
import { ContactListSection } from "./components/contact-list-section";

export const ContactsPage = () => {
    const { data: currentUser, isLoading: isLoadingUser } = useCurrentUser();
    const { data: contactsData, isLoading: isLoadingContacts } =
        useContacts(currentUser);

    const [search, setSearch] = useState("");

    const contacts = contactsData
        ? contactsData.filter(
              (contact) =>
                  contact.nickname
                      ?.toLowerCase()
                      .includes(search.toLowerCase()) ||
                  contact.account.toLowerCase().includes(search.toLowerCase()),
          )
        : [];

    const [newContactModal, setNewContactModal] = useState(false);
    const [selectedContactAccount, setSelectedAccount] = useState<string>();

    const isDesktop = useMediaQuery("(min-width: 1024px)");

    const updateSearch = (value: string) => {
        setSearch(value);
    };

    useEffect(() => {
        if (isDesktop) {
            const misMatch =
                contacts.length == 1 &&
                contacts[0].account !== selectedContactAccount;

            const isSelectedContactNoLongerInList = !contacts.some(
                (contact) => contact.account === selectedContactAccount,
            );
            if (misMatch) {
                setSelectedAccount(contacts[0].account);
            } else if (isSelectedContactNoLongerInList) {
                setSelectedAccount(undefined);
            }
        }
    }, [isDesktop, search, contacts, selectedContactAccount]);

    const handleTransferFunds = (contact: string | undefined) => {
        toast.error("Not implemented: Transfer funds");
    };

    const chainMailUser = (contactId: string) => {
        console.log({ contactId });
        toast.error("Not implemented: Chain mail user");
    };

    const selectedContact = contacts.find(
        (contact) => contact.account === selectedContactAccount,
    );

    const sectionsLetters = [
        ...new Set(contacts.map((contact) => contact.account.charAt(0))),
    ];

    const sections = sectionsLetters
        .map((letter) => ({
            letter,
            contacts: contacts.filter(
                (contact) => contact.account.charAt(0) === letter,
            ),
        }))
        .sort((a, b) => a.letter.localeCompare(b.letter));

    if (isLoadingUser || isLoadingContacts) {
        return <div>Loading...</div>;
    }

    if (currentUser === null) {
        return <div>Login to continue</div>;
    }

    return (
        <div className="mx-auto grid h-full w-full grid-cols-1 gap-2 overflow-y-auto lg:grid-cols-2">
            <NewContactDialog
                open={newContactModal}
                onOpenChange={setNewContactModal}
                onNewAccount={(newAccount) => {
                    setSelectedAccount(newAccount);
                }}
            />

            {/* Column 1 */}
            {!isDesktop && selectedContactAccount ? (
                <ContactDetails
                    contact={selectedContact}
                    onTransferFunds={handleTransferFunds}
                    onChainMailUser={chainMailUser}
                    onBack={() => setSelectedAccount(undefined)}
                />
            ) : (
                <div className="overflow-y-auto border-r bg-sidebar/60">
                    <div className="flex items-center justify-between px-4 py-2">
                        <div className="text-lg font-medium">Contacts</div>
                        <div className="flex items-center gap-2">
                            <Button
                                size="sm"
                                className="text-sm"
                                variant="outline"
                                onClick={() => setNewContactModal(true)}
                            >
                                Create contact
                                <Plus />
                            </Button>
                        </div>
                    </div>

                    <div className="relative flex items-center px-4 py-2">
                        <Input
                            placeholder="Search contacts..."
                            value={search}
                            onChange={(e) => updateSearch(e.target.value)}
                            className="pl-10"
                        />
                        <Search className="absolute left-8 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    </div>
                    {!contactsData || contactsData.length === 0 ? (
                        <div className="flex h-full items-center justify-center">
                            <p className="text-muted-foreground">
                                No contacts. Create one!
                            </p>
                        </div>
                    ) : (
                        <div>
                            {sections.map((section) => (
                                <ContactListSection
                                    key={section.letter}
                                    letter={section.letter}
                                    setSelectedContact={setSelectedAccount}
                                    selectedContactId={selectedContactAccount}
                                    contacts={section.contacts}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Column 2 */}
            {isDesktop && (
                <ContactDetails
                    contact={selectedContact}
                    onTransferFunds={handleTransferFunds}
                    onChainMailUser={chainMailUser}
                />
            )}
        </div>
    );
};
