import { AppMetadataForm } from "@components/app-metadata-form";

export function ManageAppMetadataPage() {
    return (
        <div className="container mx-auto py-8">
            <h1 className="mb-6 text-2xl font-bold">Manage App Metadata</h1>
            <AppMetadataForm />
        </div>
    );
}
