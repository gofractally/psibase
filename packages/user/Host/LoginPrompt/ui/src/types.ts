export interface AccountType {
    account: string;
    id: string;
}

export const AuthServices = {
    AUTH_SIG: "auth-sig",
    AUTH_RECOVER: "auth-rcovr",
    AUTH_ANY: "auth-any",
} as const;

export const authNeedsPrivateKey = (authService: string) =>
    authService === AuthServices.AUTH_SIG ||
    authService === AuthServices.AUTH_RECOVER;
