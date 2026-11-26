import { ActivityFeed } from "@/components/activity-feed";
import { PageHeader } from "@/components/page-header";

export function HistoryPage() {
    return (
        <div className="space-y-6">
            <PageHeader
                title="History"
                description="Payments, claim takes, booked expenses, invoices, and line changes in every currency. Newest first."
            />
            <ActivityFeed />
        </div>
    );
}
