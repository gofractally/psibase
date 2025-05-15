import { Spinner } from "./ui/spinner";

export const LoadingBlock = () => {
  return (
    <div className="h-dvh w-full flex justify-center">
      <div>
        <div className="w-full flex justify-center">
          <Spinner size="lg" className="bg-black text-center dark:bg-white" />
        </div>
        <div>Loading...</div>
      </div>
    </div>
  );
};
