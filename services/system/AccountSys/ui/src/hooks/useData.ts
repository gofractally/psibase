import { useState } from "react";

export const useData = (loadingState: boolean = false) => {
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(loadingState);
    return { isLoading, error, setError, setIsLoading };
};
