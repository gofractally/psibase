import { useMemo, useState } from "react";
import { UserPlus } from "lucide-react";

import { NicknameContactField } from "@/components/nickname-contact-field";
import { useBanxContacts } from "@/hooks/use-banx-contacts";
import { useInvites } from "@/hooks/use-banx-data";
import { useSaveContact } from "@/hooks/use-save-contact";
import { inviteClaimedBy } from "@/lib/contacts";
import {
    dismissInviteNickname,
    isInviteNicknameDismissed,
} from "@/lib/invite";

import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

export function ClaimedInviteNicks({
    returnPath,
    compact = false,
}: {
    returnPath: string;
    compact?: boolean;
}) {
    const { data: invites = [] } = useInvites();
    const { isContact, hasReadPermission, isLoading } =
        useBanxContacts(returnPath);
    const saveContact = useSaveContact(returnPath);
    const [nicks, setNicks] = useState<Record<number, string>>({});
    const [hidden, setHidden] = useState<Record<number, boolean>>({});

    const pending = useMemo(
        () =>
            invites.filter((row) => {
                const who = inviteClaimedBy(row);
                if (!who) return false;
                if (hidden[row.id] || isInviteNicknameDismissed(row.id)) {
                    return false;
                }
                if (hasReadPermission && isContact(who)) return false;
                return true;
            }),
        [invites, hidden, hasReadPermission, isContact],
    );

    if (isLoading || pending.length === 0) return null;

    return (
        <div className="space-y-3">
            {pending.map((row) => {
                const who = inviteClaimedBy(row)!;
                const nick = nicks[row.id] ?? "";
                const saving = saveContact.isPending;
                return (
                    <Card key={row.id}>
                        <CardHeader className={compact ? "pb-2" : undefined}>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <UserPlus className="size-4" />
                                {who} claimed your invite
                            </CardTitle>
                            <CardDescription>
                                Nickname them to add them to Payees. Skip if you
                                only want the credit line.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <NicknameContactField
                                account={who}
                                value={nick}
                                onChange={(v) =>
                                    setNicks((prev) => ({
                                        ...prev,
                                        [row.id]: v,
                                    }))
                                }
                                disabled={saving}
                                id={`claimed-nick-${row.id}`}
                            />
                            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={saving}
                                    onClick={() => {
                                        dismissInviteNickname(row.id);
                                        setHidden((prev) => ({
                                            ...prev,
                                            [row.id]: true,
                                        }));
                                    }}
                                >
                                    Not now
                                </Button>
                                <Button
                                    type="button"
                                    disabled={saving || !nick.trim()}
                                    onClick={() => {
                                        void saveContact
                                            .mutateAsync({
                                                account: who,
                                                nickname: nick,
                                            })
                                            .then(() => {
                                                setHidden((prev) => ({
                                                    ...prev,
                                                    [row.id]: true,
                                                }));
                                            });
                                    }}
                                >
                                    {saving ? "Saving…" : "Add contact"}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}
