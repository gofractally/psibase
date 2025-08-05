import { useMemo } from "react";
import { ReactNode } from "react";

import { Schema } from "../../types";
import { getTypeInfo } from "../../utils";
import { BooleanInput } from "./BooleanInput";
import { ByteListInput } from "./ByteListInput";
import { CharInput } from "./CharInput";
import { EnumInput } from "./EnumInput";
import { FlagsInput } from "./FlagsInput";
import { ListInput } from "./ListInput";
import { NumberInput } from "./NumberInput";
import { OptionalInput } from "./OptionalInput";
import { RecordInput } from "./RecordInput";
import { StringInput } from "./StringInput";
import { TupleInput } from "./TupleInput";
import { VariantInput, VariantValue } from "./VariantInput";

interface TypeBasedInputProps {
    type: unknown;
    schema: Schema;
    value: unknown;
    onChange: (value: unknown) => void;
    label?: ReactNode;
}

const getByteArray = (val: unknown): Uint8Array => {
    if (val instanceof Uint8Array) return val;
    if (Array.isArray(val)) return new Uint8Array(val);
    return new Uint8Array();
};

const resolveTypeRef = (type: unknown, schema: Schema): unknown => {
    if (typeof type === "number") return schema.types[type].kind;
    if (typeof type === "object" && type !== null && "type" in type) {
        return schema.types[(type as { type: number }).type].kind;
    }
    return type;
};

interface CommonInputProps {
    value: unknown;
    onChange: (value: unknown) => void;
    label?: ReactNode;
}

export const TypeBasedInput = ({
    type,
    schema,
    value,
    onChange,
    label,
}: TypeBasedInputProps) => {
    const resolvedType = resolveTypeRef(type, schema);
    const { inputType, typeName, defaultValue } = getTypeInfo(
        resolvedType,
        schema,
    );
    const actualValue = value ?? defaultValue;
    const bytes = useMemo(
        () =>
            inputType === "bytelist"
                ? getByteArray(actualValue)
                : new Uint8Array(),
        [inputType, actualValue],
    );

    const typeLabel = label ? (
        <>
            {label} <span className="type-label">({typeName})</span>
        </>
    ) : undefined;

    const commonProps: CommonInputProps = {
        value: actualValue,
        onChange,
        label: typeLabel,
    };

    if (inputType === "string")
        return <StringInput {...commonProps} value={actualValue as string} />;
    if (inputType === "char")
        return <CharInput {...commonProps} value={actualValue as string} />;
    if (inputType === "number")
        return (
            <NumberInput
                {...commonProps}
                value={actualValue as number}
                type={resolvedType as string}
            />
        );
    if (inputType === "boolean")
        return <BooleanInput {...commonProps} value={actualValue as boolean} />;

    if (typeof resolvedType === "object" && resolvedType !== null) {
        const typeObj = resolvedType as Record<string, unknown>;

        if (inputType === "bytelist") {
            return (
                <ByteListInput {...commonProps} value={bytes} schema={schema} />
            );
        }

        if (inputType === "optional" && "option" in typeObj) {
            return (
                <OptionalInput
                    {...commonProps}
                    innerType={typeObj.option}
                    schema={schema}
                    value={value}
                />
            );
        }

        if (inputType === "list" && "list" in typeObj) {
            return (
                <ListInput
                    {...commonProps}
                    itemType={typeObj.list}
                    schema={schema}
                    value={Array.isArray(value) ? value : []}
                />
            );
        }

        if (inputType === "tuple" && "tuple" in typeObj) {
            const tupleType = typeObj.tuple as { types: unknown[] };
            return (
                <TupleInput
                    {...commonProps}
                    types={tupleType.types}
                    schema={schema}
                    value={Array.isArray(value) ? value : []}
                />
            );
        }

        if (inputType === "variant" && "variant" in typeObj) {
            const variantType = typeObj.variant as {
                cases: { name: string; type?: unknown }[];
            };
            return (
                <VariantInput
                    {...commonProps}
                    cases={variantType.cases}
                    schema={schema}
                    value={actualValue as VariantValue}
                    onChange={onChange as (value: VariantValue) => void}
                />
            );
        }

        if (inputType === "record") {
            const recordType = resolveTypeRef(
                typeObj.type ?? resolvedType,
                schema,
            );
            if (
                typeof recordType === "object" &&
                recordType !== null &&
                "record" in recordType
            ) {
                const recordDef = recordType as {
                    record: { fields: { name: string; type: unknown }[] };
                };
                return (
                    <RecordInput
                        {...commonProps}
                        fields={recordDef.record.fields}
                        schema={schema}
                        value={actualValue as Record<string, unknown>}
                    />
                );
            }
        }

        if (inputType === "enum" && "enum" in typeObj) {
            const enumType = typeObj.enum as { cases: { name: string }[] };
            return (
                <EnumInput
                    {...commonProps}
                    cases={enumType.cases}
                    value={actualValue as string}
                />
            );
        }

        if (inputType === "flags" && "flags" in typeObj) {
            const flagsType = typeObj.flags as { flags: { name: string }[] };
            const flagsValue =
                typeof actualValue === "object" ? actualValue : {};
            return (
                <FlagsInput
                    flags={flagsType.flags}
                    value={flagsValue as Record<string, boolean>}
                    onChange={onChange}
                    label={typeLabel}
                />
            );
        }
    }

    if (inputType === "unsupported")
        return <div>Unsupported type in rich parameter editor</div>;

    return <div>Error: Failed to resolve type structure for {typeName}</div>;
};
