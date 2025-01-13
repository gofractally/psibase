interface InterfaceTabsProps {
  interfaces: string[];
  selectedInterface: string | null;
  onSelect: (name: string) => void;
}

export function InterfaceTabs({
  interfaces,
  selectedInterface,
  onSelect,
}: InterfaceTabsProps) {
  return (
    <div
      style={{
        display: "flex",
        marginBottom: "1rem",
        borderBottom: "1px solid #555",
      }}
    >
      {interfaces.map((intfName) => (
        <div
          key={intfName}
          onClick={() => onSelect(intfName)}
          className={`tab ${selectedInterface === intfName ? "selected" : ""}`}
        >
          {intfName.charAt(0).toUpperCase() + intfName.slice(1)}
        </div>
      ))}
    </div>
  );
}
