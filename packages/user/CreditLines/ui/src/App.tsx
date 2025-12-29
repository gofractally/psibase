
// import { Button } from "@shared/shadcn/ui/button";
// import { Label } from "@shared/shadcn/ui/label";
// import { Input } from "@shared/shadcn/ui/input";


import { supervisor } from "@shared/lib/supervisor";
import { useTickers } from "./hooks/use-tickers";

export const App = () => {

    console.log("supervisor:", supervisor);

    const { data: tickers } = useTickers();
    return (
        <div className="">
            Doop {JSON.stringify(tickers)}
        </div>
    );
};
