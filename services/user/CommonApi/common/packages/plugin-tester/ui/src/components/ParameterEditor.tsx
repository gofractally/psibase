import { useState } from "react";
import { TabControl } from "./TabControl";
import { TypeBasedInput } from "./inputs/TypeBasedInput";
import { Schema, SchemaFunction } from "../types";
import { camelCase } from "../utils";

interface ParameterEditorProps {
  value: string;
  onChange: (value: string) => void;
  selectedFunction: SchemaFunction;
  schema: Schema;
}

export const ParameterEditor = ({
  value,
  onChange,
  selectedFunction,
  schema,
}: ParameterEditorProps) => {
  const [mode, setMode] = useState<"Raw" | "Rich">("Raw");

  const handleRichEdit = (paramName: string, newValue: unknown) => {
    try {
      const currentValues = JSON.parse(value);
      const updatedValues = {
        ...currentValues,
        [camelCase(paramName)]: newValue,
      };
      onChange(JSON.stringify(updatedValues, null, 2));
    } catch (e) {
      console.error("Failed to parse parameter values:", e);
    }
  };

  const getParamValue = (paramName: string) => {
    try {
      return JSON.parse(value)[camelCase(paramName)];
    } catch {
      return null;
    }
  };

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
        <div className="rich-editor">
          {selectedFunction.params.map((param) => (
            <TypeBasedInput
              key={param.name}
              type={param.type}
              schema={schema}
              value={getParamValue(param.name)}
              onChange={(newValue) => handleRichEdit(param.name, newValue)}
              label={camelCase(param.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
