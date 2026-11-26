import { Link } from "react-router-dom";

import { useCreditLines } from "@/hooks/use-favor-data";
import { useFavorContacts } from "@/hooks/use-favor-contacts";
import { accountHref } from "@/lib/account-groups";
import type { CreditLine } from "@/lib/graphql";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export type TradeLeg =
    | { kind: "favor"; assetId: number; symbol: string }
    | { kind: "token"; tokenId: number; symbol: string };

export type TradePair = { left: TradeLeg; right: TradeLeg };

type Touch = "both" | "you" | "them";

type Person = {
    account: string;
    name: string;
    left: Touch | null;
    right: Touch | null;
};

function touchOf(
    lines: CreditLine[],
    user: string,
    other: string,
    assetId: number,
): Touch | null {
    let you = false;
    let them = false;
    for (const line of lines) {
        if (line.assetId !== assetId || line.creditor === line.debtor) continue;
        if (line.creditor === user && line.debtor === other) you = true;
        if (line.debtor === user && line.creditor === other) them = true;
    }
    if (you && them) return "both";
    if (you) return "you";
    if (them) return "them";
    return null;
}

function touchPhrase(touch: Touch): string {
    if (touch === "both") return "both ways";
    if (touch === "you") return "you extend";
    return "they extend";
}

function peopleOn(
    lines: CreditLine[],
    user: string,
    labelOf: (account: string) => string,
    leftId: number | null,
    rightId: number | null,
): Person[] {
    const accounts = new Set<string>();
    for (const line of lines) {
        if (line.creditor === line.debtor) continue;
        const asset =
            line.assetId === leftId || line.assetId === rightId;
        if (!asset) continue;
        if (line.creditor !== user && line.debtor !== user) continue;
        const other = line.creditor === user ? line.debtor : line.creditor;
        if (other === user) continue;
        accounts.add(other);
    }
    const people = [...accounts].map((account) => ({
        account,
        name: labelOf(account),
        left:
            leftId === null
                ? null
                : touchOf(lines, user, account, leftId),
        right:
            rightId === null
                ? null
                : touchOf(lines, user, account, rightId),
    }));
    people.sort((a, b) => a.name.localeCompare(b.name));
    return people.filter((person) => person.left || person.right);
}

function PersonList({
    people,
    detail,
}: {
    people: Person[];
    detail: (person: Person) => string;
}) {
    return (
        <ul className="space-y-1">
            {people.map((person) => (
                <li key={person.account}>
                    <Link
                        to={accountHref(person.account)}
                        className="hover:bg-muted flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5"
                    >
                        <span className="font-medium">{person.name}</span>
                        <span className="text-muted-foreground text-right text-sm">
                            {detail(person)}
                        </span>
                    </Link>
                </li>
            ))}
        </ul>
    );
}

function Section({
    title,
    hint,
    people,
    detail,
}: {
    title: string;
    hint: string;
    people: Person[];
    detail: (person: Person) => string;
}) {
    if (people.length === 0) return null;
    return (
        <section className="space-y-1">
            <h2 className="text-sm font-medium">{title}</h2>
            <p className="text-muted-foreground text-sm">{hint}</p>
            <PersonList people={people} detail={detail} />
        </section>
    );
}

export function TradeNetworkDialog({
    pair,
    onOpenChange,
}: {
    pair: TradePair | null;
    onOpenChange: (open: boolean) => void;
}) {
    const { user, label } = useFavorContacts("/trade");
    const { data: lines = [], isLoading, isError } = useCreditLines();
    const left = pair?.left;
    const right = pair?.right;
    const token =
        left?.kind === "token" ? left : right?.kind === "token" ? right : null;
    const iou =
        left?.kind === "favor" ? left : right?.kind === "favor" ? right : null;
    const twoIou = left?.kind === "favor" && right?.kind === "favor";
    const people =
        user && left && right
            ? peopleOn(
                  lines,
                  user,
                  label,
                  left.kind === "favor" ? left.assetId : null,
                  right.kind === "favor" ? right.assetId : null,
              )
            : [];
    const onBoth = twoIou
        ? people.filter((person) => person.left && person.right)
        : [];
    const leftOnly =
        twoIou && left.kind === "favor"
            ? people.filter((person) => person.left && !person.right)
            : [];
    const rightOnly =
        twoIou && right.kind === "favor"
            ? people.filter((person) => person.right && !person.left)
            : [];
    const leftCovered = onBoth.length + leftOnly.length > 0;
    const rightCovered = onBoth.length + rightOnly.length > 0;

    let summary = "Credit lines between you and other accounts.";
    if (left && right && token && iou) {
        summary =
            people.length === 0
                ? `Nobody is connected to you in ${iou.symbol}. ${token.symbol} is a token, so it has no credit lines. Nobody can settle this order with you.`
                : `These accounts are connected to you in ${iou.symbol}. ${token.symbol} is a token, so it has no credit lines. They settle ${iou.symbol} with you, and the tokens move through your vault.`;
    } else if (left && right && twoIou) {
        if (!leftCovered && !rightCovered) {
            summary = `Nobody is connected to you in ${left.symbol} or ${right.symbol}, so nobody can trade this pair with you.`;
        } else if (!leftCovered) {
            summary = `Nobody is connected to you in ${left.symbol}, so nobody can trade this pair with you.`;
        } else if (!rightCovered) {
            summary = `Nobody is connected to you in ${right.symbol}, so nobody can trade this pair with you.`;
        } else if (onBoth.length === 0) {
            summary = `No account is connected on both assets. A payment can still cross through you, from someone on ${left.symbol} to someone on ${right.symbol}.`;
        } else {
            summary = `Accounts on both assets can trade this pair with you. An account on only one asset cannot trade it with you.`;
        }
    }

    const pairDetail = (person: Person) => {
        if (person.left && person.right && left && right) {
            return `${left.symbol} ${touchPhrase(person.left)}, ${right.symbol} ${touchPhrase(person.right)}`;
        }
        const touch = person.left ?? person.right;
        return touch ? touchPhrase(touch) : "";
    };

    return (
        <Dialog open={pair !== null} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1.5rem)] flex-col overflow-y-auto sm:max-w-lg">
                <DialogHeader className="pr-8">
                    <DialogTitle>
                        {left && right
                            ? `${left.symbol} / ${right.symbol}`
                            : "Network"}
                    </DialogTitle>
                    <DialogDescription>
                        {isLoading
                            ? "Loading credit lines."
                            : isError
                              ? "Couldn't load your credit lines."
                              : summary}
                    </DialogDescription>
                </DialogHeader>
                {isLoading || isError || !left || !right ? null : token &&
                  iou ? (
                    <Section
                        title={iou.symbol}
                        hint="A line in this asset is who can settle it with you."
                        people={people}
                        detail={pairDetail}
                    />
                ) : (
                    <div className="space-y-4">
                        <Section
                            title="Both"
                            hint="A line with you in each asset."
                            people={onBoth}
                            detail={pairDetail}
                        />
                        <Section
                            title={`${left.symbol} only`}
                            hint={`No ${right.symbol} line, so they cannot trade this pair with you.`}
                            people={leftOnly}
                            detail={pairDetail}
                        />
                        <Section
                            title={`${right.symbol} only`}
                            hint={`No ${left.symbol} line, so they cannot trade this pair with you.`}
                            people={rightOnly}
                            detail={pairDetail}
                        />
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
