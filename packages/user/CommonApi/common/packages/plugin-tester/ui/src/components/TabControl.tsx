import { TabButton } from "./TabButton";

interface TabControlProps {
    selectedTab: string;
    onTabChange: (tab: string) => void;
    tabs: string[];
}

export const TabControl = ({
    selectedTab,
    onTabChange,
    tabs,
}: TabControlProps) => (
    <div className="tab-controls">
        {tabs.map((tab) => (
            <TabButton
                key={tab}
                selected={selectedTab === tab}
                onClick={() => onTabChange(tab)}
            >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </TabButton>
        ))}
    </div>
);
