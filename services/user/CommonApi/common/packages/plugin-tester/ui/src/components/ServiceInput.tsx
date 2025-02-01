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
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onLoad();
    }
  };

  return (
    <div className="service-input-container">
      <input
        className="service-input"
        placeholder="Service name"
        value={service}
        onChange={(e) => onServiceChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <input
        className="service-input"
        placeholder="Plugin name"
        value={plugin}
        onChange={(e) => onPluginChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button onClick={onLoad} className="common-button">
        Load
      </button>
    </div>
  );
}
