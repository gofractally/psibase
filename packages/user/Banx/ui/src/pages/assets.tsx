import { PageHeader } from "@/components/page-header";
import { useAssets } from "@/hooks/use-assets";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

export function AssetsPage() {
    const { data: assets = [], isLoading } = useAssets();

    return (
        <div>
            <PageHeader
                title="Assets"
                description="Registered currencies and metals. Enter amounts as decimals (e.g. 1.45); precision is applied by the Banx plugin."
            />
            {isLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
            ) : (
                <div className="overflow-x-auto rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Id</TableHead>
                                <TableHead>Symbol</TableHead>
                                <TableHead>Precision</TableHead>
                                <TableHead>Description</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {assets.map((a) => (
                                <TableRow key={a.id}>
                                    <TableCell className="font-mono">
                                        {a.id}
                                    </TableCell>
                                    <TableCell className="font-medium uppercase">
                                        {a.symbol}
                                    </TableCell>
                                    <TableCell>{a.precision}</TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {a.description}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}
