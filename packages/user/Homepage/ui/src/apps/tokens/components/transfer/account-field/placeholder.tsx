export const Placeholder = ({
    placeholder,
    hidden,
}: {
    placeholder?: string;
    hidden: boolean;
}) => {
    if (hidden) return null;
    return (
        <span className="text-muted-foreground">
            {placeholder || "Select account..."}
        </span>
    );
};
