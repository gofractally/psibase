import { GuildOverviewCard } from "@/components/guild-overview-card";
import { PageContainer } from "@/components/page-container";

import { useGuildAccount } from "@/hooks/use-guild-account";

import { ApplyToGuildCard } from "./components/apply-to-guild-card";
import { MyMembershipCard } from "./components/my-membership-card";

export const GuildOverview = () => {
    const guildAccount = useGuildAccount();

    return (
        <PageContainer className="space-y-6">
            <GuildOverviewCard guildAccount={guildAccount} />
            <MyMembershipCard />
            <ApplyToGuildCard />
        </PageContainer>
    );
};
