import { Nav } from "@/components/nav";
import { AppItem } from "@/components/app-item";

const App = () => {
    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav />
            <div className="mt-40 grid grid-cols-1 gap-32 lg:grid-cols-2 xl:grid-cols-3">
                <AppItem
                    name="Tokens"
                    description="Create, burn and send tokens."
                    service="tokens"
                />
                <AppItem
                    name="Explorer"
                    description="Explore recent transactions and chain history."
                    service="explorer"
                />
                <AppItem
                    name="Chain mail"
                    description="Send mail between accounts."
                    service="chainmail"
                />
                <AppItem
                    name="Doc"
                    description="Review technical documentation."
                    service="docs"
                />
            </div>
        </div>
    );
};

export default App;
