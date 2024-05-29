import { Nav } from "@/components/nav";
import { AppItem } from "@/components/app-item";

const App = () => {
    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav />
            <div className="flex flex-col sm:flex-row">
                <AppItem
                    name="Tokens"
                    description="Explore recent transactions and chain history."
                    service="tokens"
                />
                <AppItem
                    name="Explorer"
                    description="Explore recent transactions and chain history."
                    service="explorer"
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
