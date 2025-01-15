import { SchemaFunction, Schema } from "../types";
import { ParameterEditor } from "./ParameterEditor";
import { generateInitialValue } from "../utils";
import { useEffect, useState } from "react";

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

  useEffect(() => {
    const initialParams = selectedFunction.params.reduce((acc, param) => {
      acc[param.name] = generateInitialValue(param.type, schema);
      return acc;
    }, {} as Record<string, unknown>);
    const newParamValues = JSON.stringify(initialParams, null, 2);
    setParamValues(newParamValues);
    onParamValuesChange(newParamValues);
  }, [selectedFunction, schema, onParamValuesChange]);

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
      <ParameterEditor value={paramValues} onChange={handleParamChange} />
    </>
  );
};
