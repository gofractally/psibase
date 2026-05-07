import type { LocalContact } from "../contacts/types";
import type { PresenceUi } from "./hooks/use-pslack-socket";

import { ChevronDown, ChevronLeft, ChevronRight, PhoneCall } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMediaQuery } from "usehooks-ts";

import { TwoColumnSelect } from "@/components/two-column-select";

import { Avatar } from "@shared/components/avatar";
import { useContacts } from "@shared/hooks/use-contacts";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useProfile } from "@shared/hooks/use-profile";
import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import { Checkbox } from "@shared/shadcn/ui/checkbox";
import { ScrollArea } from "@shared/shadcn/ui/scroll-area";

import { NewContactDialog } from "../contacts/components/new-contact-dialog";
import { formatNames } from "../contacts/utils/format-names";
import { ChatComposer } from "./components/chat-composer";
import { CallView } from "./components/call-view";
import { ConnectionStatusBanner } from "./components/connection-status-banner";
import {
    ConversationList,
    formatGroupConversationFullTitle,
    formatGroupConversationLabel,
    formatConversationSubtitle,
} from "./components/conversation-list";
import { IncomingCallDialog } from "./components/incoming-call-dialog";
import { MessageThread } from "./components/message-thread";
import { usePslackSocket } from "./hooks/use-pslack-socket";

const SectionToggle = ({
    children,
    expanded,
    onToggle,
}: {
    children: React.ReactNode;
    expanded: boolean;
    onToggle: () => void;
}) => (
    <button
        type="button"
        onClick={onToggle}
        className="text-muted-foreground flex w-full items-center gap-1 px-4 pb-1 pt-3 text-left text-xs font-semibold uppercase tracking-wide hover:text-foreground"
        aria-expanded={expanded}
    >
        {expanded ? (
            <ChevronDown className="size-3.5" aria-hidden />
        ) : (
            <ChevronRight className="size-3.5" aria-hidden />
        )}
        {children}
    </button>
);

const PresenceDot = ({ status }: { status: PresenceUi }) => {
    const color =
        status === "online"
            ? "bg-emerald-500"
            : status === "offline"
              ? "bg-muted-foreground/40"
              : "bg-muted-foreground/25";
    const title =
        status === "online"
            ? "Online"
            : status === "offline"
              ? "Offline"
              : "Unknown";

    return (
        <span
            className={cn("inline-block size-2 shrink-0 rounded-full", color)}
            title={title}
        />
    );
};

const ContactWithPresenceRow = ({
    contact,
    isSelected,
    onSelect,
    presence,
    groupPickMode,
    groupSelected,
    setGroupIncluded,
}: {
    contact: LocalContact;
    isSelected: boolean;
    onSelect: () => void;
    presence: PresenceUi;
    groupPickMode: boolean;
    groupSelected: boolean;
    setGroupIncluded: (included: boolean) => void;
}) => {
    const { data: profile } = useProfile(contact.account, true, {});
    const [primaryName] = formatNames(
        contact.nickname,
        profile?.profile?.displayName,
        contact.account,
    );

    return (
        <div
            className={cn(
                "flex w-full items-center justify-between gap-2 rounded-sm px-3 py-1.5",
                isSelected && !groupPickMode ? "bg-muted" : "hover:bg-muted/60",
            )}
        >
            {groupPickMode ? (
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <Checkbox
                        checked={groupSelected}
                        onCheckedChange={(v) => {
                            if (v === "indeterminate") return;
                            setGroupIncluded(v);
                        }}
                        aria-label={`Include ${primaryName} in group`}
                    />
                    <Avatar
                        account={contact.account}
                        className="size-8 shrink-0"
                    />
                    <span className="truncate text-[14px] font-medium leading-snug">
                        {primaryName}
                    </span>
                </label>
            ) : (
                <button
                    type="button"
                    onClick={onSelect}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                    <Avatar
                        account={contact.account}
                        className="size-8 shrink-0"
                    />
                    <span className="truncate text-[14px] font-medium leading-snug">
                        {primaryName}
                    </span>
                </button>
            )}
            <PresenceDot status={presence} />
        </div>
    );
};

export const PslackPage = () => {
    const { data: currentUser } = useCurrentUser();
    const { data: contactsData, isLoading: isLoadingContacts } =
        useContacts(currentUser);

    const {
        wsState,
        lastWsError,
        lastInboundError,
        syncedOnce,
        authLost,
        reconnectNow,
        selfAccount,
        presenceByAccount,
        conversations,
        selectedConversationId,
        setSelectedConversationId,
        selectedConversation,
        selectedTimeline,
        unreadByConversation,
        undeliveredByConversation,
        selectedHasPendingMessages,
        openOrFocusDm,
        openGroupChat,
        sendChatMessage,
        incomingCall,
        activeCall,
        startMeetCall,
        acceptIncomingCall,
        declineIncomingCall,
        endPlaceholderCall,
        callLocalStream,
        callRemoteStream,
        callAudioMuted,
        callVideoMuted,
        callRemoteAudioMuted,
        callRemoteVideoMuted,
        callAudioOnlyFallback,
        toggleCallAudioMuted,
        toggleCallVideoMuted,
        composerDisabledReason,
    } = usePslackSocket();

    const [sidebarKey, setSidebarKey] = useState<string | undefined>();

    /** Accounts (others only) pending creation of a participant-set group. */
    const [groupCandidates, setGroupCandidates] = useState<Set<string>>(
        () => new Set(),
    );
    const [groupPickMode, setGroupPickMode] = useState(false);
    const [contactsExpanded, setContactsExpanded] = useState(true);
    const [addContactAccount, setAddContactAccount] = useState<string>();

    const isDesktop = useMediaQuery("(min-width: 1024px)");

    const contacts = useMemo(() => contactsData ?? [], [contactsData]);
    const contactAccounts = useMemo(
        () => new Set(contacts.map((c) => c.account)),
        [contacts],
    );
    const resolveGroupMemberLabel = useMemo(() => {
        const nickByAccount = new Map(
            contacts.map((c) => [
                c.account,
                c.nickname?.trim() ? c.nickname.trim() : c.account,
            ]),
        );
        return (account: string) => nickByAccount.get(account) ?? account;
    }, [contacts]);

    const others = useMemo(
        () => contacts.filter((c) => c.account !== currentUser),
        [contacts, currentUser],
    );

    useEffect(() => {
        if (isDesktop && !sidebarKey && others.length > 0) {
            setSidebarKey(others[0]?.account);
        }
    }, [isDesktop, others, sidebarKey]);

    const sidebarContact = contacts.find((c) => c.account === sidebarKey);

    const desktopDisplay = useMemo(() => {
        if (isDesktop) return "both" as const;
        return selectedConversationId ? ("right" as const) : ("left" as const);
    }, [isDesktop, selectedConversationId]);

    const presenceForSidebar = (): PresenceUi => {
        if (!sidebarContact) return "unknown";
        return presenceByAccount[sidebarContact.account] ?? "unknown";
    };

    const sidebarContactIsSelf =
        !!sidebarContact && sidebarContact.account === currentUser;

    const openDmFromSidebar = () => {
        if (!sidebarContact || groupPickMode) return;
        openOrFocusDm(sidebarContact.account);
    };

    if (isLoadingContacts) {
        return <div className="p-4">Loading…</div>;
    }

    const threadTitle = selectedConversation
        ? selectedConversation.kind === "dm"
            ? formatConversationSubtitle(
                  selectedConversation,
                  selfAccount ?? undefined,
                  resolveGroupMemberLabel,
              )
            : formatGroupConversationLabel(
                  selectedConversation,
                  selfAccount ?? undefined,
                  42,
                  resolveGroupMemberLabel,
              )
        : null;

    const threadSubtitle =
        selectedConversation?.kind === "group" && selectedConversation
            ? formatConversationSubtitle(
                  selectedConversation,
                  selfAccount ?? undefined,
                  resolveGroupMemberLabel,
              )
            : null;

    const selectedIsTwoPersonDm =
        !!selectedConversation &&
        selectedConversation.kind === "dm" &&
        selectedConversation.members.length === 2 &&
        !!selfAccount &&
        selectedConversation.members.includes(selfAccount);

    const activeCallForSelected =
        activeCall && activeCall.conversationId === selectedConversationId
            ? activeCall
            : null;

    const onStartGroup = () => {
        if (groupCandidates.size < 2) return;
        openGroupChat([...groupCandidates]);
        setGroupPickMode(false);
        setGroupCandidates(new Set());
    };

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <ConnectionStatusBanner
                wsState={wsState}
                lastWsError={lastWsError}
                lastInboundError={lastInboundError}
                authLost={authLost}
                syncedOnce={syncedOnce}
                onReconnect={reconnectNow}
            />

            <IncomingCallDialog
                call={incomingCall}
                onAccept={acceptIncomingCall}
                onDecline={declineIncomingCall}
            />

            <NewContactDialog
                open={!!addContactAccount}
                onOpenChange={(open) => {
                    if (!open) setAddContactAccount(undefined);
                }}
                initialValues={
                    addContactAccount
                        ? { account: addContactAccount }
                        : undefined
                }
            />

            <TwoColumnSelect
                displayMode={desktopDisplay}
                header={
                    <header className="flex items-center border-b px-4 py-2.5">
                        <h1 className="text-xl font-bold">Pslack</h1>
                    </header>
                }
                left={
                    <ScrollArea className="bg-sidebar/60 min-h-0 w-full lg:h-full">
                        <div className="min-h-[180px]">
                            <ConversationList
                                conversations={conversations}
                                selfAccount={selfAccount}
                                selectedConversationId={selectedConversationId}
                                onSelectConversation={setSelectedConversationId}
                                unreadByConversation={unreadByConversation}
                                undeliveredByConversation={
                                    undeliveredByConversation
                                }
                                resolveGroupMemberLabel={resolveGroupMemberLabel}
                                presenceByAccount={presenceByAccount}
                                groupPickMode={groupPickMode}
                                isDmPeerInContacts={(account) =>
                                    contactAccounts.has(account)
                                }
                                onAddDmPeerToContacts={setAddContactAccount}
                                groupActions={
                                    groupPickMode ? (
                                        <>
                                            <Button
                                                type="button"
                                                size="sm"
                                                className="text-[14px]"
                                                disabled={
                                                    groupCandidates.size < 2
                                                }
                                                onClick={onStartGroup}
                                            >
                                                Start group (
                                                {groupCandidates.size} picked)
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                size="sm"
                                                className="text-[14px]"
                                                onClick={() => {
                                                    setGroupCandidates(
                                                        new Set(),
                                                    );
                                                    setGroupPickMode(false);
                                                }}
                                            >
                                                Cancel group pick
                                            </Button>
                                        </>
                                    ) : (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="text-[14px]"
                                            onClick={() => {
                                                setContactsExpanded(true);
                                                setGroupPickMode(true);
                                            }}
                                        >
                                            New group chat
                                        </Button>
                                    )
                                }
                            />
                        </div>

                        <SectionToggle
                            expanded={contactsExpanded}
                            onToggle={() => setContactsExpanded((v) => !v)}
                        >
                            Contacts
                        </SectionToggle>
                        {contactsExpanded ? (
                            <div className="flex flex-col gap-2 px-4 pb-4 pt-0">
                                {others.length === 0 ? (
                                    <p className="text-muted-foreground px-1 py-2 text-[14px] leading-snug">
                                        No contacts yet. Add some in the
                                        Contacts app.
                                    </p>
                                ) : (
                                    <div className="flex flex-col gap-1">
                                        {others.map((contact) => {
                                            const pr: PresenceUi =
                                                presenceByAccount[
                                                    contact.account
                                                ] ?? "unknown";
                                            return (
                                                <ContactWithPresenceRow
                                                    key={contact.account}
                                                    contact={contact}
                                                    isSelected={
                                                        sidebarKey ===
                                                        contact.account
                                                    }
                                                    onSelect={() => {
                                                        setSidebarKey(
                                                            contact.account,
                                                        );
                                                        if (!groupPickMode)
                                                            openOrFocusDm(
                                                                contact.account,
                                                            );
                                                    }}
                                                    presence={pr}
                                                    groupPickMode={groupPickMode}
                                                    groupSelected={groupCandidates.has(
                                                        contact.account,
                                                    )}
                                                    setGroupIncluded={(
                                                        included,
                                                    ) =>
                                                        setGroupCandidates(
                                                            (prev) => {
                                                                const next =
                                                                    new Set(
                                                                        prev,
                                                                    );
                                                                if (included)
                                                                    next.add(
                                                                        contact.account,
                                                                    );
                                                                else
                                                                    next.delete(
                                                                        contact.account,
                                                                    );
                                                                return next;
                                                            },
                                                        )
                                                    }
                                                />
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </ScrollArea>
                }
                right={
                    <div className="flex h-full min-h-0 flex-col">
                        {selectedConversation ? (
                            <div className="border-b px-4 py-3">
                                <div className="flex items-center gap-2">
                                    {!isDesktop ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            aria-label="Back to list"
                                            onClick={() =>
                                                setSelectedConversationId(
                                                    undefined,
                                                )
                                            }
                                        >
                                            <ChevronLeft className="size-5" />
                                        </Button>
                                    ) : null}
                                    <Avatar
                                        account={
                                            selectedConversation.members.find(
                                                (m) => m !== selfAccount,
                                            ) ?? selectedConversation.members[0]
                                        }
                                        className="size-9"
                                    />
                                    <div
                                        className="min-w-0"
                                        title={
                                            selectedConversation.kind ===
                                            "group"
                                                ? formatGroupConversationFullTitle(
                                                      selectedConversation,
                                                      selfAccount ??
                                                          undefined,
                                                      resolveGroupMemberLabel,
                                                  )
                                                : undefined
                                        }
                                    >
                                        <p className="truncate text-[14px] font-medium leading-snug">
                                            {threadTitle}
                                        </p>
                                        {threadSubtitle ? (
                                            <p className="text-muted-foreground truncate text-[14px] leading-snug">
                                                {threadSubtitle}
                                            </p>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        ) : sidebarContact && !groupPickMode ? (
                            <div className="border-b px-4 py-3">
                                <div className="flex items-center gap-2">
                                    <Avatar
                                        account={sidebarContact.account}
                                        className="size-9"
                                    />
                                    <div>
                                        <p className="text-[14px] font-medium leading-snug">
                                            {sidebarContact.nickname ??
                                                sidebarContact.account}
                                        </p>
                                        <p className="text-muted-foreground flex items-center gap-2 text-[14px] leading-snug">
                                            {sidebarContact.account}
                                            <PresenceDot
                                                status={presenceForSidebar()}
                                            />
                                        </p>
                                        <Button
                                            type="button"
                                            variant="link"
                                            className="h-auto px-0 text-[14px]"
                                            onClick={openDmFromSidebar}
                                        >
                                            {sidebarContactIsSelf
                                                ? "Cannot DM yourself"
                                                : "Open DM thread"}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {selectedConversation ? (
                            <>
                                {selectedIsTwoPersonDm ? (
                                    <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
                                        <div>
                                            <p className="text-sm font-medium">
                                                Meet
                                            </p>
                                            <p className="text-muted-foreground text-xs">
                                                Start a DM Meet call. Connected
                                                sessions use WebRTC (STUN plus
                                                optional OpenRelay TURN when the
                                                node admin configures it in
                                                x-admin) with in-call controls
                                                below video.
                                            </p>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={startMeetCall}
                                        >
                                            <PhoneCall className="size-4" />
                                            Meet
                                        </Button>
                                    </div>
                                ) : null}
                                {activeCallForSelected ? (
                                    <CallView
                                        call={activeCallForSelected}
                                        onEnd={endPlaceholderCall}
                                        localStream={callLocalStream}
                                        remoteStream={callRemoteStream}
                                        audioMuted={callAudioMuted}
                                        videoMuted={callVideoMuted}
                                        remoteAudioMuted={callRemoteAudioMuted}
                                        remoteVideoMuted={callRemoteVideoMuted}
                                        audioOnlyFallback={callAudioOnlyFallback}
                                        onToggleAudio={toggleCallAudioMuted}
                                        onToggleVideo={toggleCallVideoMuted}
                                    />
                                ) : null}
                                <MessageThread
                                    timeline={selectedTimeline}
                                    selfAccount={selfAccount}
                                />
                                {selectedHasPendingMessages ? (
                                    <div className="text-muted-foreground border-t px-4 py-2 text-xs">
                                        Pending messages are stored only in this
                                        browser profile until each recipient is
                                        online and acknowledged.
                                    </div>
                                ) : null}
                                <ChatComposer
                                    disabledReason={composerDisabledReason}
                                    onSend={sendChatMessage}
                                />
                            </>
                        ) : (
                            <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-[14px] leading-snug">
                                <p>
                                    {groupPickMode
                                        ? "Choose at least two contacts below, then Start group."
                                        : "Pick a conversation on the left or open a DM from Contacts below."}
                                </p>
                            </div>
                        )}
                    </div>
                }
            />
        </div>
    );
};
