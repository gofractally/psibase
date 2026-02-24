import { PageContainer } from "@/components/page-container";

import { GlowingCard } from "@shared/components/glowing-card";
import { CardContent, CardHeader, CardTitle } from "@shared/shadcn/ui/card";

import { RemoveRepItem } from "./components/remove-rep-item";
import { SetGuildRepItem } from "./components/set-guild-rep-item";

export const Leadership = () => {
    return (
        <PageContainer>
            <GlowingCard>
                <CardHeader>
                    <CardTitle>Leadership</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <SetGuildRepItem />
                    <RemoveRepItem />
                </CardContent>
            </GlowingCard>
        </PageContainer>
    );
};
