import { type UseQueryOptions } from "@tanstack/react-query";

export type QueryOptions<L, M, N, O extends readonly unknown[]> = Omit<
    UseQueryOptions<L, M, N, O>,
    "queryKey" | "queryFn"
>;
