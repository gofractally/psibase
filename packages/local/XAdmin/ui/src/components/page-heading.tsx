import { ReactNode } from "react";

export const PageHeading = ({
    title,
    description,
    actions,
}: {
    title: string;
    description?: string;
    actions?: ReactNode;
}) => (
    <div className="mb-6 flex items-start justify-between gap-4">
        <div className="space-y-1">
            <h2 className="text-lg font-medium">{title}</h2>
            {description ? (
                <p className="text-muted-foreground text-sm">{description}</p>
            ) : null}
        </div>
        {actions}
    </div>
);
