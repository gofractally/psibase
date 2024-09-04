import { Button } from "@shadcn/button";
import { useNavigate } from "react-router-dom";

export function Home() {
    // const { query, selectedMessage, setSelectedMessageId } =
    //     useIncomingMessages();

    // useEffect(() => {
    //     setSelectedMessageId("");
    // }, []);

    const navigate = useNavigate();

    const onClickManageAppMetadata = () => {
        navigate("/register");
    };

    return (
        <div className="container mx-auto py-8">
            <h1 className="mb-2 text-2xl font-bold">Home</h1>
            <Button onClick={onClickManageAppMetadata}>
                Manage App Metadata
            </Button>
        </div>
    );
}

export default Home;
