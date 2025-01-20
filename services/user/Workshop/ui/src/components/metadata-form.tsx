import { useForm } from "react-hook-form";
import { z, ZodError } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormRootError,
} from "./ui/form";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";
import { toast } from "sonner";

const formSchema = z.object({
  name: z.string(),
  shortDescription: z.string(),
  longDescription: z.string(),
  icon: z.string(), // Base64 string
  iconMimeType: z.string(), // MIME type of the icon
  tosSubpage: z.string(),
  privacyPolicySubpage: z.string(),
  appHomepageSubpage: z.string(),
  redirectUris: z.string().array(), // List of redirect URIs
  tags: z.string().array(), // List of tags
});
export type Schema = z.infer<typeof formSchema>;

interface Props {
  existingValues?: Schema;
  onSubmit: (data: Schema) => Promise<Schema>;
}

const blankDefaultValues = formSchema.parse({
  name: "MonsterEOS",
  shortDescription: "Do this and that",
  longDescription: "Creates monsters of your wildest dreams.",
  icon: "",
  iconMimeType: "",
  tosSubpage: "/",
  privacyPolicySubpage: "/",
  appHomepageSubpage: "/",
  redirectUris: [],
  tags: [],
});

export const MetaDataForm = ({ existingValues, onSubmit }: Props) => {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: existingValues || blankDefaultValues,
  });

  const submit = async (data: Schema) => {
    try {
      form.clearErrors();
      toast("Saving...");
      await onSubmit(data);
      form.reset(data);
      toast("Success", { description: `Saved changes.` });
    } catch (error) {
      if (error instanceof ZodError) {
        error.issues.forEach((field) => {
          form.setError(field.path[0] as keyof Schema, {
            message: field.message,
          });
        });
        toast("Invalid submssion", {
          description: "One or more fields are invalid.",
        });
      } else if (error instanceof Error) {
        form.setError("root", {
          message:
            error instanceof Error
              ? error.message
              : "Unrecognised error, see log.",
        });
        toast("Request failed", { description: error.message });
      }
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(submit)}
        className="flex flex-col gap-2"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>App Name</FormLabel>
              <FormControl>
                <Input placeholder="MonsterEOS" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="shortDescription"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tagline</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="longDescription"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Long Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Tell us a little bit about yourself"
                  className="resize-none"
                  {...field}
                />
              </FormControl>

              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          disabled={form.formState.isSubmitting || !form.formState.isDirty}
        >
          Save
        </Button>
        <div>
          <FormRootError />
        </div>
      </form>
    </Form>
  );
};
