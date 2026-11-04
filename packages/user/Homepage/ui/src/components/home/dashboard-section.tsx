import type { ReactNode } from "react";

export const DashboardSection = ({
    title,
    children,
}: {
    title: ReactNode;
    children: ReactNode;
}) => (
    <section className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
            {title}
        </h2>
        {children}
    </section>
);
