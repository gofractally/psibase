import { FC } from "react";
import { Schema, SchemaFunction } from "../../types";
import { TypeBasedInput } from "../inputs/TypeBasedInput";
import { camelCase } from "../../utils";

interface RichParameterEditorProps {
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  selectedFunction: SchemaFunction;
  schema: Schema;
}

export const RichParameterEditor: FC<RichParameterEditorProps> = ({
  values,
  onChange,
  selectedFunction,
  schema,
}) => {
  const getParamKey = (paramName: string) => camelCase(paramName);

  const handleRichEdit = (paramName: string, newValue: unknown) => {
    const paramKey = getParamKey(paramName);
    const updatedValues = { ...values };

    if (
      newValue &&
      typeof newValue === "object" &&
      "bytes" in newValue &&
      "rawInput" in newValue
    ) {
      // For bytelist parameters, store both bytes and rawInput
      updatedValues[paramKey] = (newValue as { bytes: unknown }).bytes;
      updatedValues[`${paramKey}RawInput`] = (
        newValue as { rawInput: string }
      ).rawInput;
    } else {
      updatedValues[paramKey] = newValue;
    }

    onChange(updatedValues);
  };

  const getParamValue = (paramName: string) => {
    const paramKey = getParamKey(paramName);
    const rawInputKey = `${paramKey}RawInput`;

    // If this parameter has both a value and a rawInput, it's a bytelist
    if (rawInputKey in values) {
      return {
        bytes: values[paramKey],
        rawInput: values[rawInputKey] as string,
      };
    }

    return values[paramKey] ?? null;
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
