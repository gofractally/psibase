export function assertTruthy<T>(
    variable: T | undefined | null,
    errorMessage: string,
    condition: boolean = true,
): asserts variable is T {
    if (!condition || variable == null) {
        throw new Error(errorMessage);
    }
}
