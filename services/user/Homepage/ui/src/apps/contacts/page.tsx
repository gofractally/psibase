import { Search, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useMediaQuery } from "usehooks-ts";

import { Button } from "@/components/ui/button";
import { DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tooltip } from "@/components/ui/tooltip";

import { TwoColumnSelect } from "@/components/TwoColumnSelect";

import { useCurrentUser } from "@/hooks/useCurrentUser";

import { ContactDetails } from "./components/contact-details";
import { ContactListSection } from "./components/contact-list-section";
import { NewContactDialog } from "./components/new-contact-dialog";
import { useContacts } from "./hooks/useContacts";
import { useCreateContact } from "./hooks/useCreateContact";

export const ContactsPage = () => {
    const { data: currentUser } = useCurrentUser();
    const {
        data: contactsData,
        isLoading: isLoadingContacts,
        isSuccess: isSuccessContacts,
    } = useContacts(currentUser);

    const { mutate: createContact, isPending: isCreatingContact } =
        useCreateContact();

    useEffect(() => {
        console.log({ isSuccessContacts, currentUser, isCreatingContact });
        if (isSuccessContacts && currentUser && !isCreatingContact) {
            const isSelfIncluded = contactsData.some(
                (contact) => contact.account === currentUser,
            );
            console.log({ isSelfIncluded });
            if (!isSelfIncluded) {
                createContact({
                    account: currentUser,
                });
            }
        }
    }, [contactsData, currentUser, createContact, isCreatingContact]);

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
        toast.error("Not implemented: Chain mail user");
    };

    const selectedContact = contacts.find(
        (contact) => contact.account === selectedContactAccount,
    );

    const sectionsLetters = [
        ...new Set(
            contacts
                .filter((contact) => contact.account !== currentUser)
                .map((contact) => contact.account.charAt(0)),
        ),
    ];

    const contactsSections = sectionsLetters
        .map((letter) => ({
            title: letter.toUpperCase(),
            contacts: contacts.filter(
                (contact) => contact.account.charAt(0) === letter,
            ),
        }))
        .sort((a, b) => a.title.localeCompare(b.title));

    const sections = [
        {
            title: "Myself",
            contacts: contacts.filter(
                (contact) => contact.account === currentUser,
            ),
        },
        ...contactsSections,
    ];

    if (isLoadingContacts) {
        return <div>Loading...</div>;
    }

    const display = isDesktop ? "both" : selectedContact ? "right" : "left";

    return (
        <TwoColumnSelect
            left={
                <ScrollArea className="h-full w-full bg-sidebar/60">
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
                        <div className="flex h-full flex-col gap-2 pb-16">
                            {sections.map((section) => (
                                <ContactListSection
                                    key={section.title}
                                    title={section.title}
                                    setSelectedContact={setSelectedAccount}
                                    selectedContactId={selectedContactAccount}
                                    contacts={section.contacts}
                                />
                            ))}
                        </div>
                    )}
                </ScrollArea>
            }
            right={
                <ContactDetails
                    contact={selectedContact}
                    onTransferFunds={handleTransferFunds}
                    onChainMailUser={chainMailUser}
                    onBack={
                        display === "right"
                            ? () => setSelectedAccount(undefined)
                            : undefined
                    }
                />
            }
            header={
                <header className="flex items-center justify-between border-b px-4 py-2.5">
                    <div className="flex-1">
                        <h1 className="text-xl font-bold">Contacts</h1>
                    </div>
                    <NewContactDialog
                        open={newContactModal}
                        onOpenChange={setNewContactModal}
                        onNewAccount={(newAccount) => {
                            setSelectedAccount(newAccount);
                        }}
                        trigger={
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <DialogTrigger asChild>
                                        <Button variant="outline" size="icon">
                                            <UserPlus className="h-5 w-5" />
                                        </Button>
                                    </DialogTrigger>
                                </TooltipTrigger>
                                <TooltipContent>Create contact</TooltipContent>
                            </Tooltip>
                        }
                    />
                </header>
            }
            displayMode={display}
        />
    );
};
