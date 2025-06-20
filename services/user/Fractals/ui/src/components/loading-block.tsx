import { Spinner } from "./ui/spinner";

export const LoadingBlock = () => {
    return (
        <div className="flex h-dvh w-full justify-center">
            <div>
                <div className="flex w-full justify-center">
                    <Spinner
                        size="lg"
                        className="bg-black text-center dark:bg-white"
                    />
                </div>
                <div>Loading...</div>
            </div>
        </div>
    );
};
