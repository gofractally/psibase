import { connectToParent } from "penpal";

const loadWasmComponent = async (
  moduleName: string,
  operation: string,
  data: unknown
) => {
  console.log(`Loading WASM module: ${moduleName} for operation: ${operation}`);

  try {
    const { load } = await import("rollup-plugin-wit-component");

    const wasmBytes = await fetch(
      `http://localhost:8080/${moduleName}.wasm`
    ).then((res) => {
      if (!res.ok) {
        throw new Error(`Failed to fetch ${moduleName}.wasm: ${res.status}`);
      }
      return res.arrayBuffer();
    });

    // @ts-expect-error fff
    const module = await load(wasmBytes);

    console.log(`Executing operation: ${operation}`);
    const result = module[operation](data);
    console.log(`Result of ${operation}:`, result);
    return result;
  } catch (error) {
    console.error(`Error in loadWasmComponent for ${moduleName}:`, error);
    throw error;
  }
};

// Connect to parent with Penpal
connectToParent({
  methods: {
    dispatch: (moduleName: string, operation: string, data: unknown) => {
      return loadWasmComponent(moduleName, operation, data);
    },
  },
});
