export type NumericType =
    | "u8"
    | "u16"
    | "u32"
    | "u64"
    | "s8"
    | "s16"
    | "s32"
    | "s64"
    | "f32"
    | "f64";

export interface NumericConstraints {
    min: string | number;
    max: string | number;
    step: number | "any";
    allowFloat: boolean;
    is64Bit: boolean;
}

export const numericConstraints: Record<NumericType, NumericConstraints> = {
    u8: { min: 0, max: 255, step: 1, allowFloat: false, is64Bit: false },
    u16: { min: 0, max: 65535, step: 1, allowFloat: false, is64Bit: false },
    u32: {
        min: 0,
        max: 4294967295,
        step: 1,
        allowFloat: false,
        is64Bit: false,
    },
    u64: {
        min: "0",
        max: "18446744073709551615",
        step: 1,
        allowFloat: false,
        is64Bit: true,
    },
    s8: { min: -128, max: 127, step: 1, allowFloat: false, is64Bit: false },
    s16: {
        min: -32768,
        max: 32767,
        step: 1,
        allowFloat: false,
        is64Bit: false,
    },
    s32: {
        min: -2147483648,
        max: 2147483647,
        step: 1,
        allowFloat: false,
        is64Bit: false,
    },
    s64: {
        min: "-9223372036854775808",
        max: "9223372036854775807",
        step: 1,
        allowFloat: false,
        is64Bit: true,
    },
    f32: {
        min: -3.4e38,
        max: 3.4e38,
        step: "any",
        allowFloat: true,
        is64Bit: false,
    },
    f64: {
        min: -1.7976931348623157e308,
        max: 1.7976931348623157e308,
        step: "any",
        allowFloat: true,
        is64Bit: false,
    },
} as const;

export const isNumericType = (type: string): type is NumericType =>
    type in numericConstraints;

export const getNumericConstraints = (
    type: string,
): NumericConstraints | null =>
    isNumericType(type) ? numericConstraints[type] : null;

export const validateNumericInput = (value: string, type: string): boolean => {
    const constraints = getNumericConstraints(type);
    if (!constraints) return false;
    if (value === "") return true;
    if (value === "-" && !constraints.min.toString().startsWith("-"))
        return false;

    const num = constraints.is64Bit ? BigInt(value) : Number(value);
    const min = constraints.is64Bit
        ? BigInt(constraints.min.toString())
        : Number(constraints.min);
    const max = constraints.is64Bit
        ? BigInt(constraints.max.toString())
        : Number(constraints.max);

    return num >= min && num <= max;
};
