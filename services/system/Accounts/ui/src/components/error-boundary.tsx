import {
    isRouteErrorResponse,
    useNavigate,
    useRouteError,
} from "react-router-dom";

import { ErrorCard } from "./error-card";

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
            errorMessage={message}
            action={() => navigate(-1)}
            actionLabel="Go back"
        />
    );
};

export default ErrorBoundary;
