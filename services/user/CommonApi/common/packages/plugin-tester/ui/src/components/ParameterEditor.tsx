import { useState } from "react";
import { TabControl } from "./TabControl";

interface ParameterEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export const ParameterEditor = ({ value, onChange }: ParameterEditorProps) => {
  const [mode, setMode] = useState<"Raw" | "Rich">("Raw");

  return (
    <div style={{ marginBottom: "1rem" }}>
      <TabControl
        selectedTab={mode}
        onTabChange={(tab) => setMode(tab as "Raw" | "Rich")}
        tabs={["Raw", "Rich"]}
      />

      {mode === "Raw" ? (
        <textarea
          className="common-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="rich-editor">Rich editor coming soon...</div>
      )}
    </div>
  );
};
