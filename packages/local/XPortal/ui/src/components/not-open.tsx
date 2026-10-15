import { PageContainer } from "@shared/components/page-container";

export const NotOpen = () => (
    <PageContainer className="space-y-6">
        <h2 className="text-lg font-medium">
            Account requests aren&apos;t open on this network
        </h2>
        <a
            href="/admin"
            className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
        >
            Node admin? Sign in
        </a>
    </PageContainer>
);
