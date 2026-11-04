import { Search, UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMediaQuery } from "usehooks-ts";

import { EmptyState } from "@/components/empty-state";
import { Loading } from "@/components/loading";
import { TwoColumnSelect } from "@/components/two-column-select";

import { useContacts } from "@shared/hooks/use-contacts";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import { DialogTrigger } from "@shared/shadcn/ui/dialog";
import { Input } from "@shared/shadcn/ui/input";
import { ScrollArea } from "@shared/shadcn/ui/scroll-area";

import { ContactDetails } from "./components/contact-details";
import { ContactListSection } from "./components/contact-list-section";
import { NewContactDialog } from "./components/new-contact-dialog";
import { useCreateContact } from "./hooks/use-create-contact";

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
        if (isSuccessContacts && currentUser && !isCreatingContact) {
            const isSelfIncluded = contactsData.some(
                (contact) => contact.account === currentUser,
            );
            if (!isSelfIncluded) {
                createContact({
                    account: currentUser,
                });
            }
        }
    }, [
        contactsData,
        currentUser,
        createContact,
        isCreatingContact,
        isSuccessContacts,
    ]);

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

    const navigate = useNavigate();

    const handleTransferFunds = (account: string) => {
        navigate(`/tokens?to=${encodeURIComponent(account)}`);
    };

    const chainMailUser = (account: string) => {
        navigate(`/chainmail?with=${encodeURIComponent(account)}`);
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
    ].filter((section) => section.contacts.length > 0);

    if (isLoadingContacts) {
        return <Loading className="flex-1" label="Loading contacts…" />;
    }

    const display = isDesktop ? "both" : selectedContact ? "right" : "left";
    const otherCount =
        contactsData?.filter((c) => c.account !== currentUser).length ?? 0;
    const hasNoContacts = !contactsData || contactsData.length === 0;

    return (
        <TwoColumnSelect
            left={
                <div className="bg-sidebar/40 relative flex h-full min-h-0 flex-col overflow-hidden">
                    <div className="border-border relative z-10 shrink-0 border-b px-3 py-2">
                        <Search className="text-muted-foreground left-5.5 pointer-events-none absolute top-1/2 size-3.5 -translate-y-1/2" />
                        <Input
                            placeholder="Search contacts…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="bg-background h-8 pl-8 text-[13px]"
                            aria-label="Search contacts"
                        />
                    </div>
                    {hasNoContacts ? (
                        <EmptyState
                            icon={Users}
                            detail="Contacts are stored locally on this device."
                            action={
                                <Button
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => setNewContactModal(true)}
                                >
                                    <UserPlus className="size-3.5" />
                                    New contact
                                </Button>
                            }
                        >
                            No contacts yet
                        </EmptyState>
                    ) : contacts.length === 0 ? (
                        <EmptyState
                            icon={Search}
                            detail="Try a different search term."
                        >
                            No matches
                        </EmptyState>
                    ) : (
                        <ScrollArea className="min-h-0 flex-1">
                            <div className="flex flex-col pb-16">
                                {sections.map((section) => (
                                    <ContactListSection
                                        key={section.title}
                                        title={section.title}
                                        setSelectedContact={setSelectedAccount}
                                        selectedContactId={
                                            selectedContactAccount
                                        }
                                        contacts={section.contacts}
                                    />
                                ))}
                            </div>
                        </ScrollArea>
                    )}
                </div>
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
                <header className="bg-card/40 flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2.5">
                    <div className="flex min-w-0 items-baseline gap-2">
                        <h1 className="text-sm font-semibold">Contacts</h1>
                        <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
                            {otherCount}
                        </span>
                        <span className="text-muted-foreground hidden truncate text-xs sm:inline">
                            · stored locally on this device
                        </span>
                    </div>
                    <NewContactDialog
                        open={newContactModal}
                        onOpenChange={setNewContactModal}
                        onNewAccount={(newAccount) => {
                            setSelectedAccount(newAccount);
                        }}
                        trigger={
                            <DialogTrigger asChild>
                                <Button size="sm" className="h-7 text-xs">
                                    <UserPlus className="size-3.5" />
                                    New contact
                                </Button>
                            </DialogTrigger>
                        }
                    />
                </header>
            }
            displayMode={display}
        />
    );
};
