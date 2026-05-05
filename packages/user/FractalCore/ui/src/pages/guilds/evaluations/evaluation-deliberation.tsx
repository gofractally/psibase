import { Info } from "lucide-react";
import SortableList from "react-easy-sort";
import { useParams } from "react-router-dom";

import { RankedAccountItem } from "@/components/evaluations/deliberation/ranked-account-item";
import { StatusBadges } from "@/components/evaluations/deliberation/status-badges";
import { UnrankedAccountChip } from "@/components/evaluations/deliberation/unranked-account-chip";

import { useRanking } from "@/hooks/fractals/use-ranking";

import { GlowingCard } from "@shared/components/glowing-card";
import { PageContainer } from "@shared/components/page-container";
import { useContacts } from "@shared/hooks/use-contacts";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import {
    CardAction,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

const usePageParams = () => {
    const { guildAccount, groupNumber } = useParams<{
        guildAccount: string;
        groupNumber: string;
    }>();

    return {
        guildAccount,
        groupNumber: Number(groupNumber),
    };
};

export const EvaluationDeliberation = () => {
    const { groupNumber } = usePageParams();
    const { data: currentUser } = useCurrentUser();
    const { data: contacts } = useContacts(currentUser);
    const {
        add,
        remove,
        onSortEnd,
        rankedAccounts,
        unrankedAccounts,
        isLoading,
        isSaving,
        isSaved,
    } = useRanking(groupNumber);

    return (
        <PageContainer className="space-y-6">
            <GlowingCard cardClassName="z-0">
                <CardHeader>
                    <CardTitle>Group {groupNumber} evaluation</CardTitle>
                    <CardDescription>
                        Evaluate participants in your group
                    </CardDescription>
                    <CardAction>
                        <StatusBadges isSaving={isSaving} isSaved={isSaved} />
                    </CardAction>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div>
                        <h2 className="text-base font-semibold">Unranked</h2>
                        <div className="text-muted-foreground text-sm">
                            Select unranked participants to rank them
                        </div>
                        <div className="mt-2">
                            {isLoading ? (
                                <Skeleton className="h-10 w-full" />
                            ) : (
                                <div className="flex w-full flex-wrap gap-2">
                                    {unrankedAccounts.length > 0 ? (
                                        unrankedAccounts.map((account) => (
                                            <UnrankedAccountChip
                                                key={account}
                                                account={account}
                                                currentUser={currentUser}
                                                contacts={contacts}
                                                onAdd={add}
                                            />
                                        ))
                                    ) : (
                                        <div className="text-muted-foreground text-sm italic">
                                            All participants are ranked
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    <div>
                        <h2 className="text-base font-semibold">Ranked</h2>
                        <div className="text-muted-foreground text-sm">
                            Drag and drop ranked participants to reorder them,
                            with those more highly ranked towards the top.
                        </div>
                        <SortableList
                            className="mt-4 flex w-full flex-col gap-2"
                            draggedItemClassName="cursor-grabbing"
                            onSortEnd={onSortEnd}
                            lockAxis="y"
                        >
                            {rankedAccounts.length > 0 ? (
                                rankedAccounts.map((account: string) => (
                                    <RankedAccountItem
                                        key={account}
                                        account={account}
                                        currentUser={currentUser}
                                        contacts={contacts}
                                        onRemove={remove}
                                    />
                                ))
                            ) : (
                                <div className="text-muted-foreground flex items-center gap-2 text-sm italic">
                                    <Info className="h-4 w-4" />
                                    Select participants above to rank them
                                </div>
                            )}
                        </SortableList>
                    </div>
                </CardContent>
            </GlowingCard>
        </PageContainer>
    );
};
