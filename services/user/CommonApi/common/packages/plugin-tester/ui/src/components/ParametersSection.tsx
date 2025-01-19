import { useState } from "react";
import { Schema, SchemaFunction } from "../types";
import { ParameterEditor } from "./ParameterEditor";

interface ParametersSectionProps {
  selectedFunction: SchemaFunction;
  schema: Schema;
  onParamValuesChange: (values: string) => void;
}

export const ParametersSection = ({
  selectedFunction,
  schema,
  onParamValuesChange,
}: ParametersSectionProps) => {
  const [paramValues, setParamValues] = useState("");

  const handleParamChange = (newValue: string) => {
    setParamValues(newValue);
    onParamValuesChange(newValue);
  };

  if (selectedFunction.params.length === 0) {
    return null;
  }

  return (
    <>
      <h3 style={{ marginBottom: "0.5rem" }}>Parameters</h3>
      <ParameterEditor
        value={paramValues}
        onChange={handleParamChange}
        selectedFunction={selectedFunction}
        schema={schema}
      />
    </>
  );
};
