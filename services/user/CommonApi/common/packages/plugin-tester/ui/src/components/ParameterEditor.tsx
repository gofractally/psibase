import { useState } from "react";
import { TabControl } from "./TabControl";
import { Schema, SchemaFunction } from "../types";
import { RawParameterEditor } from "./editors/RawParameterEditor";
import { RichParameterEditor } from "./editors/RichParameterEditor";

interface ParameterEditorProps {
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  selectedFunction: SchemaFunction;
  schema: Schema;
}

export const ParameterEditor = ({
  values,
  onChange,
  selectedFunction,
  schema,
}: ParameterEditorProps) => {
  const [mode, setMode] = useState<"Raw" | "Rich">("Rich");

  return (
    <div style={{ marginBottom: "1rem" }}>
      <TabControl
        selectedTab={mode}
        onTabChange={(tab) => setMode(tab as "Raw" | "Rich")}
        tabs={["Rich", "Raw"]}
      />

      {mode === "Raw" ? (
        <RawParameterEditor values={values} onChange={onChange} />
      ) : (
        <RichParameterEditor
          values={values}
          onChange={onChange}
          selectedFunction={selectedFunction}
          schema={schema}
        />
      )}
    </div>
  );
};
