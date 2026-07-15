import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Textarea } from "@shared/shadcn/ui/textarea";

type Props = {
    pasteJson: string;
    busy: boolean;
    onPasteJsonChange: (value: string) => void;
    onPasteSave: () => void;
};

export const PasteIceServersCard = ({
    pasteJson,
    busy,
    onPasteJsonChange,
    onPasteSave,
}: Props) => (
    <Card>
        <CardHeader>
            <CardTitle>Paste iceServers JSON</CardTitle>
            <CardDescription>
                Optional fallback: paste the JSON <strong>array</strong> returned
                by OpenRelay&apos;s credentials endpoint. App name and API key
                above are still saved if provided.
            </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
            <Textarea
                placeholder='[{"urls":["turn:…"],"username":"…","credential":"…"}, …]'
                value={pasteJson}
                onChange={(e) => onPasteJsonChange(e.target.value)}
                rows={8}
                className="font-mono text-xs"
            />
            <Button
                type="button"
                variant="secondary"
                disabled={busy || !pasteJson.trim()}
                onClick={() => void onPasteSave()}
            >
                Save pasted iceServers
            </Button>
        </CardContent>
    </Card>
);
