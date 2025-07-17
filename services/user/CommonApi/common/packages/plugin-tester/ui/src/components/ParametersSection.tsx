import { Schema, SchemaFunction } from "../types";
import { ParameterEditor } from "./ParameterEditor";

interface ParametersSectionProps {
    selectedFunction: SchemaFunction;
    schema: Schema;
    values: Record<string, unknown>;
    onParamValuesChange: (values: Record<string, unknown>) => void;
}

export const ParametersSection = ({
    selectedFunction,
    schema,
    values,
    onParamValuesChange,
}: ParametersSectionProps) => {
    if (selectedFunction.params.length === 0) {
        return null;
    }

    return (
        <>
            <h3 className="parameters-title">Parameters</h3>
            <ParameterEditor
                values={values}
                onChange={onParamValuesChange}
                selectedFunction={selectedFunction}
                schema={schema}
            />
        </>
    );
};
