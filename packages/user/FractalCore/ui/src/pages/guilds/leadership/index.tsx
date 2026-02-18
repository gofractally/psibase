import { GlowingCard } from "@shared/components/glowing-card";
import { CardContent, CardHeader, CardTitle } from "@shared/shadcn/ui/card";

import { RegisterCandidacyItem } from "./components/register-candidacy-item";
import { RemoveRepItem } from "./components/remove-rep-item";
import { ResignAsRepItem } from "./components/resign-as-rep-item";
import { SetGuildRepItem } from "./components/set-guild-rep-item";

export const Leadership = () => {
    return (
        <div className="mx-auto w-full max-w-5xl p-4 px-6">
            <GlowingCard>
                <CardHeader>
                    <CardTitle>Leadership</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <RegisterCandidacyItem />
                    <SetGuildRepItem />
                    <RemoveRepItem />
                    <ResignAsRepItem />
                </CardContent>
            </GlowingCard>
        </div>
    );
};
