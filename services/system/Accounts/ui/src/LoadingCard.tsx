import { Card, CardHeader } from "@shared/shadcn/ui/card";
import { LoaderCircle } from "lucide-react";
import { CardTitle } from "@shared/shadcn/ui/card";

export const LoadingCard = () => (
  <Card className="w-[350px] mx-auto mt-4">
    <CardHeader>
      <div className="mx-auto">
        <LoaderCircle className="w-12 h-12 animate-spin" />
      </div>
      <CardTitle className="text-center">Loading...</CardTitle>
    </CardHeader>
  </Card>
);
