import { useEffect, useState } from "react";

interface TokenReturn {
    token: string | undefined;
}

export const useToken = (user?: string): TokenReturn => {

    const [token, setToken] = useState<string>();

    const requestAndSetSignature = async (user: string): Promise<void> => {
        setToken('hello')
    }

    useEffect(() => {
        if (user) {
            requestAndSetSignature(user)
        }
    }, [user])

    return { token }
}