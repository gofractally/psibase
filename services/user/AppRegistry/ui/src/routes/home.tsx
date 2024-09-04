import { AppCardList } from "@components/app-card-list";
import { Separator } from "@shadcn/separator";

import { useEffect } from "react";

export function Home() {
    // const { query, selectedMessage, setSelectedMessageId } =
    //     useIncomingMessages();

    // useEffect(() => {
    //     setSelectedMessageId("");
    // }, []);

    return (
        <div className="container mx-auto py-8">
            <h1 className="mb-2 text-2xl font-bold">Home</h1>

            <div className="py-4">Want to register your app?</div>
            <a
                href="#/register"
                className="mb-8 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
                Click Here
            </a>
            <AppCardList />
        </div>
    );
}

export default Home;
