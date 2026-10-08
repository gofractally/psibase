export interface AccountType {
    account: string;
    id: string;
}

export const AuthServices = {
    AUTH_SIG: "auth-sig",
    AUTH_ANY: "auth-any",
} as const;
