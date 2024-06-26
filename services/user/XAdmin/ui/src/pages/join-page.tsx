import { EaseIn } from "@/components/EaseIn";
import { UrlForm } from "@/components/forms/url";
import { useConnect } from "../hooks/useConnect";

export const JoinPage = () => {
    const { mutateAsync } = useConnect();

    return (
        <EaseIn>
            <div className="flex w-full flex-col justify-center sm:h-dvh">
                <div className="mx-auto flex w-full max-w-screen-lg flex-col gap-3">
                    <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl">
                        Join
                    </h1>{" "}
                    <p className="mt-3 leading-7 text-muted-foreground">
                        Connect to a psibase compatible node to join a network.
                    </p>
                    <div>
                        <UrlForm onSubmit={mutateAsync} />
                    </div>
                </div>
            </div>
        </EaseIn>
    );
};
