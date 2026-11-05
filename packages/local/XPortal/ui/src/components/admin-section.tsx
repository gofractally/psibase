/** `action` sits at the end of the heading row. */
export const AdminSection = ({
    title,
    action,
    children,
}: {
    title: string;
    action?: React.ReactNode;
    children: React.ReactNode;
}) => (
    <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-medium">{title}</h2>
            {action}
        </div>
        {children}
    </section>
);
