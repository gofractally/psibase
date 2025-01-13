interface ServiceInputProps {
  service: string;
  plugin: string;
  onServiceChange: (value: string) => void;
  onPluginChange: (value: string) => void;
  onLoad: () => void;
}

export function ServiceInput({
  service,
  plugin,
  onServiceChange,
  onPluginChange,
  onLoad,
}: ServiceInputProps) {
  return (
    <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
      <input
        style={{ padding: "0.5rem" }}
        placeholder="Service name"
        value={service}
        onChange={(e) => onServiceChange(e.target.value)}
      />
      <input
        style={{ padding: "0.5rem" }}
        placeholder="Plugin name"
        value={plugin}
        onChange={(e) => onPluginChange(e.target.value)}
      />
      <button onClick={onLoad} className="common-button">
        Load
      </button>
    </div>
  );
}
