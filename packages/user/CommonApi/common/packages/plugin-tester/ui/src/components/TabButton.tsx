interface TabButtonProps {
    selected: boolean;
    onClick: () => void;
    children: React.ReactNode;
}

export const TabButton = ({ selected, onClick, children }: TabButtonProps) => (
    <div className={`tab ${selected ? "selected" : ""}`} onClick={onClick}>
        {children}
    </div>
);
