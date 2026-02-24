import { PageContainer } from "@/components/page-container";

import { GlowingCard } from "@shared/components/glowing-card";
import { CardContent, CardHeader, CardTitle } from "@shared/shadcn/ui/card";

import { RemoveRepItem } from "./components/remove-rep-item";
import { SetEvaluationsScheduleItem } from "./components/set-evaluations-schedule-item.tsx";
import { SetGuildMetadataItem } from "./components/set-guild-metadata-item";
import { SetGuildRepItem } from "./components/set-guild-rep-item";

export const Leadership = () => {
    return (
        <PageContainer>
            <GlowingCard>
                <CardHeader>
                    <CardTitle>Guild Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <SetGuildMetadataItem />
                    <SetEvaluationsScheduleItem />
                    <SetGuildRepItem />
                    <RemoveRepItem />
                </CardContent>
            </GlowingCard>
        </PageContainer>
    );
};
