import { Separator } from "@shadcn/separator";

import { useEffect } from "react";

export function Home() {
    // const { query, selectedMessage, setSelectedMessageId } =
    //     useIncomingMessages();

    // useEffect(() => {
    //     setSelectedMessageId("");
    // }, []);

    return (
        <div>
            <div className="flex items-center justify-between px-4">
                <h1 className="text-xl font-bold">Home</h1>
            </div>
            <Separator />
            <div className="py-4">Want to register your app?</div>
        </div>
    );
}

export default Home;
