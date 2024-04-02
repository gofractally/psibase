interface NavHeaderProps {
    menuItems: string[];
    activeItem: string;
}

export const NavHeader = ({
    menuItems,
    activeItem: currentNav,
}: NavHeaderProps) => {
    return (
        <Header>
            <LogoGroup>
                <img src="/psibase.svg" alt="Psibase Logo" />
            </LogoGroup>
            <LogoTitle />
            <NavGroup>
                {menuItems.map((item) => (
                    <NavItem
                        key={item}
                        label={item}
                        isActive={currentNav === item}
                    />
                ))}
            </NavGroup>
        </Header>
    );
};

const Header = ({ children }: { children: React.ReactNode }) => (
    <header className="mx-auto flex max-w-7xl justify-between">
        {children}
    </header>
);

const LogoGroup = ({ children }: { children: React.ReactNode }) => (
    <div className="mr-12 flex items-center">{children}</div>
);

const LogoTitle = () => <h1 className="ml-4 text-2xl">Admin Panel</h1>;

const NavGroup = ({ children }: { children: React.ReactNode }) => (
    <nav className="flex space-x-4">{children}</nav>
);

interface NavItemProps {
    label: string;
    onClick?: () => void;
    isActive?: boolean;
}

const NavItem = ({ label, isActive }: NavItemProps) => {
    const classBase =
        "rounded-md px-3 py-2 text-sm font-bold text-gray-500 no-underline ";
    const className =
        classBase +
        (isActive ? "text-gray-900 bg-gray-200" : "hover:underline");

    return isActive ? (
        <div className={className}>{label}</div>
    ) : (
        <a href={`#${label}`} className={className}>
            {label}
        </a>
    );
};
