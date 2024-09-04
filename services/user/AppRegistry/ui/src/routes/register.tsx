import { AppRegistryForm } from "../components/app-registry-form";

export function AppRegistryPage() {
    return (
        <div className="container mx-auto py-8">
            <h1 className="mb-6 text-2xl font-bold">Register Your App</h1>
            <AppRegistryForm />
        </div>
    );
}
