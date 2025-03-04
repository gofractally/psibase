import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { z, ZodError } from "zod";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Params } from "@/hooks/useSetProducers";

export type ProducersFormData = z.infer<typeof Params>;

export const ProducersForm = ({
  onSubmit,
  initialData,
}: {
  onSubmit: (data: ProducersFormData) => Promise<void>; // No return value expected from useSetProducers
  initialData?: ProducersFormData;
}) => {
  const form = useForm<ProducersFormData>({
    resolver: zodResolver(Params),
    defaultValues: initialData ?? {
      prods: [{ name: "", authClaim: { tag: "pubkey-pem", val: "" } }],
      mode: "existing",
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "prods",
  });

  const handleAddProducer = () => {
    append({ name: "", authClaim: { tag: "pubkey-pem", val: "" } });
  };

  const submit = async (values: ProducersFormData) => {
    try {
      await onSubmit(values);
      form.reset(values);
    } catch (e) {
      console.error("Failed to submit Producers form:", e);
      if (e instanceof ZodError) {
        e.errors.forEach((error) => {
          const path = error.path.join(".");
          console.log(`Setting error at ${path}: ${error.message}`);
          form.setError(path as keyof ProducersFormData, {
            message: error.message,
          });
        });
      } else {
        form.setError("root", {
          message: e instanceof Error ? e.message : "An unknown error occurred",
        });
      }
    }
  };

  console.log(form.formState.errors, "errors");

  const currentMode = form.getValues("mode");
  console.log({ currentMode });

  return (
    <div className="space-y-6 ">
      <div>
        <h2 className="text-lg font-medium">Producers</h2>
        <p className="text-sm text-muted-foreground">
          Manage producers by adding their name and PEM key. Each producer
          requires both fields.
        </p>
      </div>

      {form.formState.errors.root && (
        <p className="text-sm text-destructive">
          {form.formState.errors.root.message}
        </p>
      )}

      <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
        {/* Mode Selection */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="mode">Consensus Mode</Label>
          <Select
            onValueChange={(value) => {
              console.log({ value });
              form.setValue("mode", value as "cft" | "bft" | "existing");
            }}
            value={form.watch("mode")}
          >
            <SelectTrigger id="mode">
              <SelectValue placeholder="Select mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="existing">Existing</SelectItem>
              <SelectItem value="cft">Crash Fault Tolerance (CFT)</SelectItem>
              <SelectItem value="bft">
                Byzantine Fault Tolerance (BFT)
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            CFT has a tolerance of N / 2 node failures but requires{" "}
            <span className="text-foreground">all nodes</span> to be honest.
          </p>
          <p className="text-sm text-muted-foreground">
            BFT can tolerate N / 3 nodes acting maliciously.
          </p>
          {form.formState.errors.mode && (
            <p className="text-sm text-destructive">
              {form.formState.errors.mode.message}
            </p>
          )}
        </div>

        {/* Producers List */}
        <div className="flex flex-col gap-4">
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="flex flex-col gap-2 p-3 border rounded-md"
            >
              <div className="flex justify-between items-center">
                <Label htmlFor={`prods.${index}.name`}>Producer Name</Label>
                <Button
                  variant="destructive"
                  size="icon"
                  disabled={fields.length === 1}
                  className="p-2 flex items-center justify-center"
                  type="button"
                  onClick={() => remove(index)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <Input
                id={`prods.${index}.name`}
                placeholder="Producer name"
                {...form.register(`prods.${index}.name`)}
              />
              {form.formState.errors.prods?.[index]?.name && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.prods[index]?.name?.message}
                </p>
              )}

              <Label htmlFor={`prods.${index}.authClaim.val`}>PEM Key</Label>
              <Textarea
                id={`prods.${index}.authClaim.val`}
                placeholder="Paste PEM key here (e.g., -----BEGIN PUBLIC KEY-----...)"
                rows={5}
                {...form.register(`prods.${index}.authClaim.val`)}
              />
              {form.formState.errors.prods?.[index]?.authClaim?.val && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.prods[index]?.authClaim?.val?.message}
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-between">
          <Button variant="outline" type="button" onClick={handleAddProducer}>
            Add Producer
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
};
