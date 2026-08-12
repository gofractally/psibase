export function PageHeader({
    title,
    description,
    action,
}: {
    title: string;
    description?: string;
    action?: React.ReactNode;
}) {
    return (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">
                    {title}
                </h1>
                {description ? (
                    <p className="text-muted-foreground text-sm">
                        {description}
                    </p>
                ) : null}
            </div>
            {action ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {action}
                </div>
            ) : null}
        </div>
    );
}
