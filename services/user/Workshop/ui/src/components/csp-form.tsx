import { Label } from "./ui/label";
import { Button } from "./ui/button";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { z } from "zod";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "./ui/input";
import { Trash2 } from "lucide-react";
import { useState } from "react";

const formSchema = z.object({
  globalPolicy: z.string(),
  individualPolicies: z.array(
    z.object({
      path: z.string().min(1, "Path is required"),
      csp: z.string().min(1, "CSP is required"),
    })
  ),
});


export const CspForm = ({
  onSubmit,
  initialData,
}: {
  onSubmit: (data: z.infer<typeof formSchema>) => Promise<z.infer<typeof formSchema>>;
  initialData: z.infer<typeof formSchema>;
}) => {


  const [isOpen, setIsOpen] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: initialData,
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "individualPolicies",
  });


  const submit = async (values: z.infer<typeof formSchema>) => {
    try {
      const response = await onSubmit(values);
      console.log({ response }, 'is the response')
      form.reset(response);
      setIsOpen(false);
    } catch (e) {
      console.error("Failed to submit CSP form:", e);
      form.setError("root", { message: e instanceof Error ? e.message : "An unknown error occurred" });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex flex-row items-center justify-between rounded-lg border p-4">
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Content Security Headers</DialogTitle>
            <DialogDescription>
              <p className="my-3">
                Define your application's Content Security Policy (CSP)
                settings. The global CSP applies by default, but specific paths
                with their own CSP will take precedence.
              </p>
              {form.formState.errors.root && (
                <p className="text-sm text-destructive mb-3">
                  {form.formState.errors.root.message}
                </p>
              )}
              <form
                onSubmit={form.handleSubmit(submit)}
                className="space-y-4"
              >
                <Input
                  placeholder="Global policy"
                  {...form.register(`globalPolicy`)}
                />
                <div className="flex flex-col gap-2">
                  {fields.map((field, index) => (
                    <div key={field.id} className="flex items-center space-x-2">
                      <Input
                        placeholder="Path"
                        {...form.register(`individualPolicies.${index}.path`)}
                      />
                      <Input
                        placeholder="CSP"
                        {...form.register(`individualPolicies.${index}.csp`)}
                      />
                      <Button
                        variant="destructive"
                        size="icon"
                        className=" p-2 flex items-center justify-center"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between">
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => append({ csp: "", path: "" })}
                  >
                    Add Path
                  </Button>
                  <Button type="submit" disabled={form.formState.isSubmitting}>Save</Button>
                </div>
              </form>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
        <div className="space-y-0.5">
          <Label className="text-base">Content Security Policy</Label>
        </div>
        <DialogTrigger asChild>
          <Button variant="outline" onClick={() => setIsOpen(true)}>Edit</Button>
        </DialogTrigger>
      </div>
    </Dialog>
  );
};
