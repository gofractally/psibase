import { ErrorCard } from "@shared/components/error-card";

export const App = () => {
    const error = "This app displays permission request prompts from other apps for your approval. Navigating here directly is not currently supported.";
    return (
        <div className="flex min-h-screen items-center justify-center">
            <ErrorCard error={new Error(error)} title="Hi!" />
        </div>
    );
};
