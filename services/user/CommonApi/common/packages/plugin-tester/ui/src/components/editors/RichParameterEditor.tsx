import { FC } from "react";
import { Schema, SchemaFunction } from "../../types";
import { TypeBasedInput } from "../inputs/TypeBasedInput";
import { camelCase } from "../../utils";

interface RichParameterEditorProps {
  value: string;
  onChange: (value: string) => void;
  selectedFunction: SchemaFunction;
  schema: Schema;
}

const parseParameterValues = (value: string): Record<string, unknown> => {
  try {
    return value ? JSON.parse(value) : {};
  } catch (e) {
    console.error("Failed to parse parameter values:", e);
    return {};
  }
};

const stringify = (values: Record<string, unknown>): string => {
  return JSON.stringify(values, null, 2);
};

export const RichParameterEditor: FC<RichParameterEditorProps> = ({
  value,
  onChange,
  selectedFunction,
  schema,
}) => {
  const getParamKey = (paramName: string) => camelCase(paramName);

  const handleRichEdit = (paramName: string, newValue: unknown) => {
    const currentValues = parseParameterValues(value);
    const updatedValues = {
      ...currentValues,
      [getParamKey(paramName)]: newValue,
    };
    onChange(stringify(updatedValues));
  };

  const getParamValue = (paramName: string) => {
    const values = parseParameterValues(value);
    return values[getParamKey(paramName)] ?? null;
  };

  return (
    <div className="rich-editor">
      {selectedFunction.params.map((param) => (
        <TypeBasedInput
          key={param.name}
          type={param.type}
          schema={schema}
          value={getParamValue(param.name)}
          onChange={(newValue) => handleRichEdit(param.name, newValue)}
          label={getParamKey(param.name)}
        />
      ))}
    </div>
  );
};
