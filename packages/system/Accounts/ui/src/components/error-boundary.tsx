import {
    isRouteErrorResponse,
    useNavigate,
    useRouteError,
} from "react-router-dom";

import { ErrorCard } from "@shared/components/error-card";

export const ErrorBoundary = () => {
    const error = useRouteError();
    const navigate = useNavigate();

    let message = "Unknown error";

    if (isRouteErrorResponse(error)) {
        message = error.data.message ?? error.statusText;
    } else if (error instanceof Error) {
        message = error.message;
    }

    return (
        <ErrorCard
            error={new Error(message)}
            retry={() => navigate(-1)}
            retryLabel="Go back"
        />
    );
};

export default ErrorBoundary;
