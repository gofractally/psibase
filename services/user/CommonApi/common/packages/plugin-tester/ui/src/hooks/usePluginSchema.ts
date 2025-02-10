import { useState, useEffect, useCallback } from "react";
import { Supervisor } from "@psibase/common-lib";
import { Schema } from "../types";

export function usePluginSchema(supervisor: Supervisor) {
  const [schemaText, setSchemaText] = useState("");
  const [schema, setSchema] = useState<Schema | null>(null);

  const clearSchema = useCallback(() => {
    setSchemaText("");
    setSchema(null);
  }, []);

  const loadSchema = useCallback(
    async (service: string, plugin: string) => {
      try {
        setSchemaText(await supervisor.getJson({ service, plugin }));
      } catch (e) {
        console.error("Error loading schema:", e);
        clearSchema();
      }
    },
    [supervisor, clearSchema]
  );

  useEffect(() => {
    if (schemaText) {
      try {
        setSchema(JSON.parse(schemaText) as Schema);
      } catch {
        alert("Invalid plugin JSON");
        clearSchema();
      }
    }
  }, [schemaText, clearSchema]);

  return { schema, loadSchema, clearSchema };
}
