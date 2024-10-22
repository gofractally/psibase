import { ModeToggle } from "@components";
import { Separator } from "@shadcn/separator";

export function About() {
    return (
        <div className="flex h-full flex-col">
            <div className="container flex h-[56px] flex-shrink-0 items-center justify-between">
                <h1 className="text-xl font-bold">About</h1>
                <ModeToggle />
            </div>
            <Separator className="flex-shrink-0" />
            <div className="container py-4">
                <p className="py-4">About Registry app</p>
            </div>
        </div>
    );
}

export default About;
