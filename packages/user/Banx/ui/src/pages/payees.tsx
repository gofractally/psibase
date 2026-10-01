import { useMemo, useState } from "react";

import { Contact, ExternalLink, HandCoins, Receipt, Search } from "lucide-react";

import { BookExpenseDialog } from "@/components/book-expense-dialog";
import { NewDepositLoanDialog } from "@/components/new-deposit-loan-dialog";
import { PageHeader } from "@/components/page-header";
import { useAssetMap } from "@/hooks/use-assets";
import { useBookAuths } from "@/hooks/use-banx-data";
import type { BookAuth } from "@/lib/graphql";

import { siblingUrl } from "@psibase/common-lib";

import { Avatar } from "@shared/components/avatar";
import { ShowContactsButton } from "@shared/components/show-contacts-button";
import { useBranding } from "@shared/hooks/use-branding";
import {
    type LocalContact,
    useContacts,
} from "@shared/hooks/use-contacts";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useHasProfilesReadPermission } from "@shared/hooks/use-has-profiles-read-permission";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

function contactLabel(c: LocalContact): string {
    return (c.nickname?.trim() || c.account).toLowerCase();
}

function bookAuthLive(auth: BookAuth): boolean {
    return !auth.expiresAt || auth.expiresAt * 1000 >= Date.now();
}

function bookAuthSpendable(auth: BookAuth): boolean {
    return bookAuthLive(auth) && Number(auth.remaining) > 0;
}

function PayeeRow({
    contact,
    onPay,
    books,
}: {
    contact: LocalContact;
    onPay: () => void;
    books: { assetId: number; label: string; onClick: () => void }[];
}) {
    const nickname = contact.nickname?.trim();
    return (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Avatar account={contact.account} className="size-10 shrink-0" />
            <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                    {nickname || contact.account}
                </p>
                {nickname ? (
                    <p className="text-muted-foreground truncate text-sm">
                        {contact.account}
                    </p>
                ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
                {books.map((book) => (
                    <Button
                        key={book.assetId}
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0 gap-1.5"
                        onClick={book.onClick}
                    >
                        <Receipt className="size-4" />
                        {book.label}
                    </Button>
                ))}
                <Button
                    type="button"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    onClick={onPay}
                >
                    <HandCoins className="size-4" />
                    Deposit
                </Button>
            </div>
        </div>
    );
}

export function PayeesPage() {
    const { data: user } = useCurrentUser();
    const { data: networkName } = useBranding();
    const { assets, precisionOf, symbolOf } = useAssetMap();
    const { data: bookAuths = [] } = useBookAuths();

    const { data: hasPermission, isPending: permissionPending } =
        useHasProfilesReadPermission({ enabled: !!user });

    const {
        data: contacts = [],
        isLoading: contactsLoading,
        isError: contactsError,
        error: contactsErr,
    } = useContacts(
        user,
        { enabled: !!user && !!hasPermission },
        { enabled: true, returnPath: "/payees" },
    );

    const [search, setSearch] = useState("");
    const [dialogOpen, setDialogOpen] = useState(false);
    const [selectedAccount, setSelectedAccount] = useState<string | undefined>();
    const [bookAuth, setBookAuth] = useState<BookAuth | null>(null);

    const contactsUrl = useMemo(
        () => siblingUrl(null, networkName, "contacts"),
        [networkName],
    );

    const payees = useMemo(() => {
        const q = search.trim().toLowerCase();
        return contacts
            .filter((c) => c.account !== user)
            .filter((c) => {
                if (!q) return true;
                return (
                    c.account.toLowerCase().includes(q) ||
                    (c.nickname?.toLowerCase().includes(q) ?? false) ||
                    (c.email?.toLowerCase().includes(q) ?? false)
                );
            })
            .sort((a, b) => contactLabel(a).localeCompare(contactLabel(b)));
    }, [contacts, search, user]);

    const openPay = (account: string) => {
        setSelectedAccount(account);
        setDialogOpen(true);
    };

    const needsAuth = hasPermission === false;
    const loading =
        !!user && (permissionPending || (hasPermission && contactsLoading));

    return (
        <div className="space-y-8">
            <PageHeader
                title="Payees"
                description="Common recipients from your Contacts app — like a banking payee list. Book a deposit, or an expense if they authorized you."
                action={
                    <div className="flex flex-wrap items-center gap-2">
                        <ShowContactsButton returnPath="/payees" />
                        <Button variant="outline" size="sm" asChild>
                            <a
                                href={contactsUrl}
                                target="_blank"
                                rel="noreferrer"
                            >
                                Manage contacts
                                <ExternalLink className="ml-1.5 size-3.5" />
                            </a>
                        </Button>
                    </div>
                }
            />

            <BookExpenseDialog
                open={!!bookAuth}
                onOpenChange={(open) => {
                    if (!open) setBookAuth(null);
                }}
                auth={bookAuth}
                symbol={bookAuth ? symbolOf(bookAuth.assetId) : ""}
                precision={
                    bookAuth ? precisionOf(bookAuth.assetId) : 0
                }
            />

            <NewDepositLoanDialog
                open={dialogOpen}
                onOpenChange={(open) => {
                    setDialogOpen(open);
                    if (!open) setSelectedAccount(undefined);
                }}
                assets={assets}
                precisionOf={precisionOf}
                initialAccount={selectedAccount}
            />

            {needsAuth ? (
                <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed p-10 text-center">
                    <Contact className="text-muted-foreground size-10" />
                    <div className="space-y-1">
                        <p className="font-medium">Connect Contacts</p>
                        <p className="text-muted-foreground max-w-md text-sm">
                            Banx reads your payee list from the Contacts app
                            (via Profiles). Grant read access once, then your
                            nicknames and accounts appear here.
                        </p>
                    </div>
                    <ShowContactsButton returnPath="/payees" />
                </div>
            ) : loading ? (
                <div className="divide-y overflow-hidden rounded-xl border">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div
                            key={i}
                            className="flex items-center gap-3 px-4 py-3"
                        >
                            <Skeleton className="size-10 shrink-0 rounded-full" />
                            <div className="flex-1 space-y-2">
                                <Skeleton className="h-4 w-32" />
                                <Skeleton className="h-3 w-24" />
                            </div>
                            <Skeleton className="h-8 w-28" />
                        </div>
                    ))}
                </div>
            ) : contactsError ? (
                <p className="text-destructive text-sm">
                    Could not load contacts:{" "}
                    {contactsErr instanceof Error
                        ? contactsErr.message
                        : "unknown error"}
                </p>
            ) : (
                <div className="space-y-3">
                    <div className="relative max-w-md">
                        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search payees…"
                            className="pl-9"
                            aria-label="Search payees"
                        />
                    </div>

                    {payees.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
                            <Contact className="text-muted-foreground size-10" />
                            <div className="space-y-1">
                                <p className="font-medium">
                                    {search.trim()
                                        ? "No matching payees"
                                        : "No payees yet"}
                                </p>
                                <p className="text-muted-foreground max-w-md text-sm">
                                    {search.trim()
                                        ? "Try a different search."
                                        : "Add people in the Contacts app, then they show up here for deposits."}
                                </p>
                            </div>
                            {!search.trim() && (
                                <Button variant="outline" size="sm" asChild>
                                    <a
                                        href={contactsUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        Open Contacts
                                        <ExternalLink className="ml-1.5 size-3.5" />
                                    </a>
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className="divide-y overflow-hidden rounded-xl border">
                            {payees.map((c) => {
                                const inbound = user
                                    ? bookAuths.filter(
                                          (a) =>
                                              a.creditor === user &&
                                              a.debtor === c.account &&
                                              bookAuthSpendable(a),
                                      )
                                    : [];
                                return (
                                    <PayeeRow
                                        key={c.account}
                                        contact={c}
                                        onPay={() => openPay(c.account)}
                                        books={inbound.map((auth) => ({
                                            assetId: auth.assetId,
                                            label: `Book ${symbolOf(auth.assetId)}`,
                                            onClick: () => setBookAuth(auth),
                                        }))}
                                    />
                                );
                            })}
                        </div>
                    )}

                    <p className="text-muted-foreground text-xs">
                        {payees.length} payee
                        {payees.length === 1 ? "" : "s"}
                        {contacts.length > 0
                            ? ` · synced from Contacts`
                            : null}
                    </p>
                </div>
            )}
        </div>
    );
}
