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
  <div
    className="tab-controls"
    style={{
      display: "flex",
      marginBottom: "1rem",
      borderBottom: "1px solid #555",
    }}
  >
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
