import { Separator } from "@shadcn/separator";

export function About() {
    return (
        <div>
            <div className="flex items-center justify-between px-4">
                <h1 className="text-xl font-bold">About</h1>
            </div>
            <Separator />
            <div className="py-4">About Workshop app</div>
        </div>
    );
}

export default About;
