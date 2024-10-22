import { Button } from "@shadcn/button";
import { useNavigate } from "react-router-dom";
import { Separator } from "@shadcn/separator";
import { ModeToggle, SupportRequestForm } from "@components";

export function Home() {
    const navigate = useNavigate();

    const onClickManageAppMetadata = () => {
        navigate("/register");
    };

    return (
        <div className="flex h-full flex-col">
            <div className="container flex h-[56px] flex-shrink-0 items-center justify-between">
                <h1 className="text-xl font-bold">Home</h1>
                <ModeToggle />
            </div>
            <Separator className="flex-shrink-0" />
            <div className="container py-4">
                <Button
                    variant="secondary"
                    size="sm"
                    className="my-2 mr-2 max-w-[15rem]"
                    onClick={onClickManageAppMetadata}
                >
                    Manage App Metadataa
                </Button>
                {/* <SupportRequestForm /> */}
            </div>
        </div>
    );
}

export default Home;
