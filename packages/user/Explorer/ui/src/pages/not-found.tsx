import { Link } from "react-router-dom";

import { Button } from "@shared/shadcn/ui/button";

export const NotFoundPage = () => (
    <div className="bg-card/70 flex flex-col items-center gap-3 rounded-xl border p-12 text-center">
        <div className="text-muted-foreground font-mono text-5xl">404</div>
        <div className="text-lg font-semibold">This page does not exist</div>
        <Button asChild variant="outline" size="sm">
            <Link to="/">Back to the dashboard</Link>
        </Button>
    </div>
);
