import { FileUploader } from "@/components/file-uploader";

export const Upload = () => {
  return (
    <div className="mx-auto w-full grid p-4 grid-cols-1  gap-8 max-w-screen-xl">
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">Upload Files</h1>
        <FileUploader />
      </div>
    </div>
  );
};
