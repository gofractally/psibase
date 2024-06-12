import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MenuContent } from "./menu-content";

interface NavHeaderProps {
    menuItems: string[];
    activeItem: string;
}

export const NavHeader = ({ menuItems, activeItem }: NavHeaderProps) => {
    return (
        <Header>
            <LogoGroup>
                <img src="/psibase.svg" alt="Psibase Logo" />
            </LogoGroup>
            <h1 className=" scroll-m-20 text-4xl font-extrabold tracking-tight">
                Admin Panel
            </h1>
            <div className="flex gap-3">
                <Tabs value={activeItem}>
                    <TabsList>
                        {menuItems.map((item) => (
                            <TabsTrigger asChild key={item} value={item}>
                                <a href={`#${item}`}>{item}</a>
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
                <MenuContent />
            </div>
        </Header>
    );
};

const Header = ({ children }: { children: React.ReactNode }) => (
    <header className="mx-auto my-4 flex max-w-7xl justify-between">
        {children}
    </header>
);

const LogoGroup = ({ children }: { children: React.ReactNode }) => (
    <div className="mr-12 flex items-center">{children}</div>
);
