import { SchemaFunction, Schema, TypeDefinition } from "../types";
import { camelCase, withArgs } from "../utils";
import { Supervisor } from "@psibase/common-lib";
import { useState, useEffect } from "react";

const handlePrimitiveType = (type: string): unknown => {
  switch (type) {
    case "string":
      return "";
    case "u32":
    case "u64":
      return 0;
    default:
      return "";
  }
};

const generateInitialValue = (type: unknown, schema: Schema): unknown => {
  if (typeof type === "number") {
    return generateInitialValue(schema.types[type].kind, schema);
  }

  if (typeof type === "string") {
    return handlePrimitiveType(type);
  }

  if (typeof type !== "object" || type === null) {
    return "";
  }

  const typeObj = type as TypeDefinition["kind"];
  if (typeObj.record) {
    return typeObj.record.fields.reduce(
      (
        acc: Record<string, unknown>,
        field: { name: string; type: unknown }
      ) => {
        acc[camelCase(field.name)] = generateInitialValue(field.type, schema);
        return acc;
      },
      {}
    );
  }
  if (typeObj.list) return [];
  if (typeObj.type) return generateInitialValue(typeObj.type, schema);

  return "";
};

export function ExecutionTabs({
  selectedFunction,
  service,
  plugin,
  selectedInterfaceName,
  supervisor,
  schema,
}: {
  selectedFunction: SchemaFunction;
  service: string;
  plugin: string;
  selectedInterfaceName: string;
  supervisor: Supervisor;
  schema: Schema;
}) {
  const [paramValues, setParamValues] = useState("");
  const [responseText, setResponseText] = useState("No response yet");
  const [executionTab, setExecutionTab] = useState<"Execution" | "Embed">(
    "Execution"
  );

  useEffect(() => {
    const initialParams = selectedFunction.params.reduce((acc, param) => {
      acc[param.name] = generateInitialValue(param.type, schema);
      return acc;
    }, {} as Record<string, unknown>);
    setParamValues(JSON.stringify(initialParams, null, 2));
    setResponseText("No response yet");
    setExecutionTab("Execution");
  }, [selectedFunction, schema]);

  const parseParams = (): unknown[] => {
    try {
      const parsed = JSON.parse(paramValues);
      return Array.isArray(parsed) ? parsed : Object.values(parsed);
    } catch {
      return [];
    }
  };

  const handleExecute = async () => {
    try {
      const response = await supervisor.functionCall(
        withArgs(
          service,
          plugin,
          camelCase(selectedInterfaceName),
          camelCase(selectedFunction.name),
          parseParams()
        )
      );
      setResponseText(
        response === undefined
          ? "Execution successful"
          : JSON.stringify(
              response,
              (_key, value) =>
                typeof value === "bigint" ? value.toString() : value,
              2
            )
      );
    } catch (e) {
      console.error(e);
      setResponseText("Error: Check console for more details.");
    }
  };

  const generateEmbedCode = (): string => {
    return `const response = await supervisor.functionCall({
  service: "${service}",
  plugin: "${plugin}",
  intf: "${camelCase(selectedInterfaceName)}",
  method: "${camelCase(selectedFunction.name)}",
  params: ${JSON.stringify(JSON.parse(paramValues), null, 2)}
});`;
  };

  return (
    <>
      {selectedFunction.params.length > 0 && (
        <>
          <h3 style={{ marginBottom: "0.5rem" }}>Parameters</h3>
          <textarea
            className="common-textarea"
            style={{ marginBottom: "1rem" }}
            value={paramValues}
            onChange={(e) => setParamValues(e.target.value)}
          />
        </>
      )}

      <div
        style={{
          display: "flex",
          marginBottom: "1rem",
          borderBottom: "1px solid #555",
        }}
      >
        {["Execution", "Embed"].map((tab) => (
          <div
            key={tab}
            onClick={() => setExecutionTab(tab as "Execution" | "Embed")}
            className={`tab ${executionTab === tab ? "selected" : ""}`}
          >
            {tab}
          </div>
        ))}
      </div>

      {executionTab === "Execution" ? (
        <>
          <div style={{ marginBottom: "1rem", textAlign: "left" }}>
            <button onClick={handleExecute} className="common-button">
              Execute
            </button>
          </div>
          <h3 style={{ marginBottom: "0.5rem" }}>Response</h3>
          <textarea className="common-textarea" readOnly value={responseText} />
        </>
      ) : (
        <div
          style={{
            marginTop: "1rem",
            whiteSpace: "pre-wrap",
            fontFamily: "monospace",
            textAlign: "left",
          }}
        >
          <p style={{ marginBottom: "0.5rem" }}>
            To call this plugin function from your own application, use:
          </p>
          <textarea
            className="common-textarea"
            style={{ height: "200px" }}
            readOnly
            value={(() => {
              try {
                return generateEmbedCode();
              } catch (e) {
                return "Parameters configuration produces invalid JSON";
              }
            })()}
          />
        </div>
      )}
    </>
  );
}
