import { useState, useEffect, useRef } from "react";
import { TabControl } from "./TabControl";
import { Schema, SchemaFunction } from "../types";
import { RawParameterEditor } from "./editors/RawParameterEditor";
import { RichParameterEditor } from "./editors/RichParameterEditor";
import { camelCase, getTypeInfo } from "../utils";

interface ParameterEditorProps {
  value: string;
  onChange: (value: string) => void;
  selectedFunction: SchemaFunction;
  schema: Schema;
}

const generateInitialParameterValues = (
  params: { name: string; type: unknown }[],
  schema: Schema
): Record<string, unknown> => {
  return params.reduce((acc, param) => {
    acc[camelCase(param.name)] = getTypeInfo(param.type, schema).defaultValue;
    return acc;
  }, {} as Record<string, unknown>);
};

const stringify = (values: Record<string, unknown>): string => {
  return JSON.stringify(values, null, 2);
};

export const ParameterEditor = ({
  value,
  onChange,
  selectedFunction,
  schema,
}: ParameterEditorProps) => {
  const [mode, setMode] = useState<"Raw" | "Rich">("Rich");
  const lastFunctionRef = useRef(selectedFunction);

  // Initialize values when selectedFunction changes or value is empty
  useEffect(() => {
    const functionChanged = lastFunctionRef.current !== selectedFunction;
    if (functionChanged || !value) {
      const initialValues = generateInitialParameterValues(
        selectedFunction.params,
        schema
      );
      onChange(stringify(initialValues));
      lastFunctionRef.current = selectedFunction;
    }
  }, [selectedFunction, schema, onChange, value]);

  return (
    <div style={{ marginBottom: "1rem" }}>
      <TabControl
        selectedTab={mode}
        onTabChange={(tab) => setMode(tab as "Raw" | "Rich")}
        tabs={["Rich", "Raw"]}
      />

      {mode === "Raw" ? (
        <RawParameterEditor value={value} onChange={onChange} />
      ) : (
        <RichParameterEditor
          value={value}
          onChange={onChange}
          selectedFunction={selectedFunction}
          schema={schema}
        />
      )}
    </div>
  );
};
