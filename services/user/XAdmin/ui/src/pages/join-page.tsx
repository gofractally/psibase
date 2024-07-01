import { EaseIn } from "@/components/EaseIn";
import { UrlForm } from "@/components/forms/url";
import { useConnect } from "../hooks/useConnect";
import { NavHeader } from "@/components/nav-header";
import { MenuContent } from "@/components/menu-content";
import { SetupWrapper } from "./setup-wrapper";

export const JoinPage = () => {
    const { mutateAsync } = useConnect();

    return (
        <SetupWrapper>
            <div className="mx-auto h-full w-full  max-w-screen-lg  flex-col gap-3">
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
        </SetupWrapper>
    );
};
