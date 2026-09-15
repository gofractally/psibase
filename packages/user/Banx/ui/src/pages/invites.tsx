import { useEffect, useMemo, useState } from "react";

import { Copy, Plus, UserPlus } from "lucide-react";

import { ClaimedInviteNicks } from "@/components/claimed-invite-nicks";

import { AssetField, GracePeriodField } from "@/components/form-fields";
import { formatExpiresAt } from "@/components/expires-at-picker";
import { PageHeader } from "@/components/page-header";
import { useAssetMap } from "@/hooks/use-assets";
import { useInvites } from "@/hooks/use-banx-data";
import { useCreateInvite, useDeleteInvite } from "@/hooks/use-banx-mutations";
import { displayAmount } from "@/lib/amount";
import {
    DEFAULT_GRACE_SECONDS,
    daysToGraceSeconds,
    formatGracePeriod,
    ppmToPercent,
    type GracePreset,
} from "@/lib/constants";
import {
    MAX_PERCENT,
    MIN_PERCENT_STEP,
    PPM_SCALE,
    amountFieldValidator,
    percentFieldValidator,
    percentStringToPpm,
    useAppForm,
} from "@/lib/form";
import { inviteClaimedBy } from "@/lib/contacts";
import type { BanxInvite } from "@/lib/graphql";
import {
    forgetInviteToken,
    inviteClaimUrl,
    recalledInviteToken,
    rememberInviteToken,
} from "@/lib/invite";

import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";
import { toast } from "@shared/shadcn/ui/sonner";

async function copyText(text: string) {
    if ("clipboard" in navigator) {
        await navigator.clipboard.writeText(text);
        toast.success("Copied to clipboard");
        return;
    }
    toast.error("Copy failed (needs a secure context)");
}

function InviteTable({
    rows,
    symbolOf,
    revokingId,
    onRevoke,
    showCopy,
}: {
    rows: BanxInvite[];
    symbolOf: (id: number) => string;
    revokingId: number | null;
    onRevoke: (row: BanxInvite) => void;
    showCopy: boolean;
}) {
    const showClaimed = rows.some((row) => inviteClaimedBy(row));
    return (
        <div className="overflow-x-auto rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Id</TableHead>
                        {showClaimed ? <TableHead>Claimed by</TableHead> : null}
                        <TableHead>Asset</TableHead>
                        <TableHead className="text-right">Limit</TableHead>
                        <TableHead>APR</TableHead>
                        <TableHead>Grace</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((row) => {
                        const token = recalledInviteToken(row.id);
                        const url = token
                            ? inviteClaimUrl(token)
                            : undefined;
                        const claimedBy = inviteClaimedBy(row);
                        return (
                            <TableRow key={row.id}>
                                <TableCell className="font-mono">
                                    {row.id}
                                </TableCell>
                                {showClaimed ? (
                                    <TableCell className="font-medium">
                                        {claimedBy ?? "—"}
                                    </TableCell>
                                ) : null}
                                <TableCell>
                                    {symbolOf(row.assetId)}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                    {displayAmount(row.limit)}
                                </TableCell>
                                <TableCell>
                                    {ppmToPercent(row.interestRatePpm)}
                                </TableCell>
                                <TableCell>
                                    {formatGracePeriod(row.graceSeconds)}
                                </TableCell>
                                <TableCell className="text-sm">
                                    {formatExpiresAt(row.expiry)}
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-2">
                                        {showCopy && url ? (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="gap-1.5"
                                                onClick={() =>
                                                    void copyText(url)
                                                }
                                            >
                                                <Copy className="size-3.5" />
                                                Copy
                                            </Button>
                                        ) : null}
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="destructive"
                                            disabled={revokingId === row.id}
                                            onClick={() => void onRevoke(row)}
                                        >
                                            {revokingId === row.id
                                                ? "Removing…"
                                                : claimedBy
                                                  ? "Remove"
                                                  : "Revoke"}
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}

export function InvitesPage() {
    const { assets, symbolOf, precisionOf } = useAssetMap();
    const { data: invites = [], isLoading } = useInvites();
    const createInvite = useCreateInvite();
    const deleteInvite = useDeleteInvite();

    const [createOpen, setCreateOpen] = useState(false);
    const [share, setShare] = useState<{ id: number; url: string } | null>(
        null,
    );
    const [revokingId, setRevokingId] = useState<number | null>(null);

    const { outstanding, claimed } = useMemo(() => {
        const outstanding: BanxInvite[] = [];
        const claimed: BanxInvite[] = [];
        for (const row of invites) {
            if (inviteClaimedBy(row)) claimed.push(row);
            else outstanding.push(row);
        }
        return { outstanding, claimed };
    }, [invites]);

    const form = useAppForm({
        defaultValues: {
            assetId: undefined as number | undefined,
            limit: "100",
            interestPct: "0",
            deplete: false,
            gracePreset: "7" as GracePreset,
            graceDays: "7",
        },
        onSubmit: async ({ value }) => {
            if (value.assetId === undefined) return;
            const created = await createInvite.mutateAsync({
                assetId: value.assetId,
                limit: value.limit.trim(),
                depleteOnDebit: value.deplete,
                interestRatePpm: percentStringToPpm(
                    value.interestPct,
                    PPM_SCALE,
                ),
                graceSeconds:
                    value.gracePreset === "none"
                        ? 0
                        : daysToGraceSeconds(
                              value.gracePreset === "custom"
                                  ? Number(value.graceDays.trim())
                                  : Number(value.gracePreset),
                          ),
            });
            rememberInviteToken(created.inviteId, created.inviteToken);
            setCreateOpen(false);
            setShare({
                id: created.inviteId,
                url: inviteClaimUrl(created.inviteToken),
            });
        },
    });

    useEffect(() => {
        if (!createOpen) return;
        form.reset({
            assetId: undefined,
            limit: "100",
            interestPct: "0",
            deplete: false,
            gracePreset: "7",
            graceDays: "7",
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [createOpen]);

    const revoke = async (row: BanxInvite) => {
        const claimed = inviteClaimedBy(row);
        if (
            !window.confirm(
                claimed
                    ? `Remove invite #${row.id}? ${claimed}'s credit line stays.`
                    : `Revoke invite #${row.id}? The link will stop working.`,
            )
        ) {
            return;
        }
        setRevokingId(row.id);
        try {
            await deleteInvite.mutateAsync({ inviteId: row.id });
            forgetInviteToken(row.id);
            if (share?.id === row.id) setShare(null);
        } finally {
            setRevokingId(null);
        }
    };

    return (
        <div>
            <PageHeader
                title="Invites"
                description="Invite one person onto the network and Banx. When they claim, you extend them this credit line and can nickname them into Payees."
                action={
                    <Button
                        type="button"
                        onClick={() => setCreateOpen(true)}
                        className="gap-1.5"
                    >
                        <Plus className="size-4" />
                        New invite
                    </Button>
                }
            />

            {isLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
            ) : invites.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                    No outstanding invites. Create one to share a claim link.
                </p>
            ) : (
                <div className="space-y-8">
                    <ClaimedInviteNicks returnPath="/invites" />
                    {outstanding.length === 0 ? (
                        claimed.length > 0 ? (
                            <p className="text-muted-foreground text-sm">
                                No unclaimed invites. Claimed ones stay listed
                                until you remove them.
                            </p>
                        ) : null
                    ) : (
                        <InviteTable
                            rows={outstanding}
                            symbolOf={symbolOf}
                            revokingId={revokingId}
                            onRevoke={revoke}
                            showCopy
                        />
                    )}
                    {claimed.length > 0 ? (
                        <div className="space-y-3">
                            <h2 className="text-sm font-medium">Claimed</h2>
                            <InviteTable
                                rows={claimed}
                                symbolOf={symbolOf}
                                revokingId={revokingId}
                                onRevoke={revoke}
                                showCopy={false}
                            />
                        </div>
                    ) : null}
                </div>
            )}

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>New Banx invite</DialogTitle>
                        <DialogDescription>
                            Anyone with the link can join Banx. A new network
                            account can be created with it. On claim you extend
                            this credit line (default grace{" "}
                            {formatGracePeriod(DEFAULT_GRACE_SECONDS)}).
                        </DialogDescription>
                    </DialogHeader>
                    <form
                        className="grid gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void form.handleSubmit();
                        }}
                    >
                        <form.Field
                            name="assetId"
                            children={(field) => (
                                <AssetField
                                    assets={assets}
                                    value={field.state.value}
                                    onChange={(id) => field.handleChange(id)}
                                />
                            )}
                        />
                        <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                            <form.Subscribe
                                selector={(s) => s.values.assetId}
                                children={(assetId) => (
                                    <form.AppField
                                        name="limit"
                                        validators={
                                            assetId !== undefined
                                                ? {
                                                      onChange:
                                                          amountFieldValidator(
                                                              precisionOf(
                                                                  assetId,
                                                              ),
                                                              {
                                                                  allowZero:
                                                                      false,
                                                              },
                                                          ),
                                                      onSubmit:
                                                          amountFieldValidator(
                                                              precisionOf(
                                                                  assetId,
                                                              ),
                                                              {
                                                                  allowZero:
                                                                      false,
                                                              },
                                                          ),
                                                  }
                                                : undefined
                                        }
                                        children={(field) => (
                                            <field.TextField
                                                label="Credit limit"
                                                inputMode="decimal"
                                                required
                                            />
                                        )}
                                    />
                                )}
                            />
                            <form.AppField
                                name="interestPct"
                                validators={{
                                    onChange:
                                        percentFieldValidator(MAX_PERCENT),
                                    onSubmit:
                                        percentFieldValidator(MAX_PERCENT),
                                }}
                                children={(field) => (
                                    <field.TextField
                                        label="Interest APR %"
                                        inputMode="decimal"
                                        min={0}
                                        max={MAX_PERCENT}
                                        step={MIN_PERCENT_STEP}
                                    />
                                )}
                            />
                        </div>
                        <form.Subscribe
                            selector={(s) => ({
                                preset: s.values.gracePreset,
                                days: s.values.graceDays,
                            })}
                            children={({ preset, days }) => (
                                <GracePeriodField
                                    preset={preset}
                                    days={days}
                                    onPresetChange={(p) => {
                                        form.setFieldValue("gracePreset", p);
                                        if (p === "none") {
                                            form.setFieldValue(
                                                "graceDays",
                                                "0",
                                            );
                                        } else if (p !== "custom") {
                                            form.setFieldValue("graceDays", p);
                                        }
                                    }}
                                    onDaysChange={(d) =>
                                        form.setFieldValue("graceDays", d)
                                    }
                                />
                            )}
                        />
                        <form.AppField
                            name="deplete"
                            children={(field) => (
                                <field.CheckboxField label="Deplete limit on each draw (non-revolving)" />
                            )}
                        />
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => setCreateOpen(false)}
                            >
                                Cancel
                            </Button>
                            <form.AppForm>
                                <form.SubmitButton
                                    labels={["Create invite", "Creating…"]}
                                />
                            </form.AppForm>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog
                open={!!share}
                onOpenChange={(open) => {
                    if (!open) setShare(null);
                }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <UserPlus className="size-5" />
                            Share invite
                        </DialogTitle>
                        <DialogDescription>
                            Send this link. The recipient can create a network
                            account if they need one, then they land in Banx
                            with your credit line.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex items-center space-x-2">
                        <div className="grid flex-1 gap-2">
                            <Label htmlFor="invite-link" className="sr-only">
                                Link
                            </Label>
                            <Input
                                id="invite-link"
                                value={share?.url ?? ""}
                                readOnly
                            />
                        </div>
                        <Button
                            type="button"
                            size="sm"
                            className="px-3"
                            onClick={() =>
                                share ? void copyText(share.url) : undefined
                            }
                        >
                            <span className="sr-only">Copy</span>
                            <Copy className="h-4 w-4" />
                        </Button>
                    </div>
                    <DialogFooter className="sm:justify-start">
                        <DialogClose asChild>
                            <Button type="button" variant="secondary">
                                Close
                            </Button>
                        </DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
