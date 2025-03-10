# Plugin Tester

A React-based application for testing and interacting with psibase plugins. This tool allows developers to load, inspect, and execute plugin functions through a user-friendly interface.

## Project Overview

The Plugin Tester is a development tool designed to help developers test and interact with psibase plugins. It provides a UI for:

1. Loading plugin schemas from psibase services
2. Browsing available functions
3. Constructing function parameters with appropriate input controls
4. Executing functions and viewing responses
5. Generating code snippets for embedding function calls in other applications

## Tech Stack

- **Framework**: React with TypeScript
- **Build Tool**: Vite
- **Dependencies**:
  - `@psibase/common-lib`: Core library for psibase integration
  - React 18.2.0

## Project Structure

### Core Components

- `App.tsx`: Main application component that integrates the LoginBar and PluginLoader
- `PluginLoader.tsx`: Central component that manages plugin loading, function selection, and parameter input
- `LoginBar.tsx`: Handles user authentication with the psibase supervisor

### Key Directories

- `/src/components/`: UI components for the application
  - `ExecutionTabs.tsx`: Handles function execution and displays results
  - `FunctionSelector.tsx`: UI for selecting functions from the loaded plugin
  - `ParameterEditor.tsx`: Generic parameter editing component
  - `inputs/`: Input components for different data types
  - `editors/`: Specialized editors for complex data types
- `/src/hooks/`: Custom React hooks
  - `usePluginSchema.ts`: Hook for loading and parsing plugin schemas

### Important Files

- `types.ts`: TypeScript interfaces for the schema structure
- `utils.ts`: Utility functions for type handling and data transformation
- `NumericConstraints.ts`: Utilities for handling numeric types
- `RpcUtils.ts`: Utilities for RPC calls
- `StringUtils.ts`: String manipulation utilities

## Key Concepts

### Schema Structure

The plugin schema follows a structured format defined in `types.ts`:

- `Schema`: Top-level container for worlds, interfaces, and types
- `World`: Represents a collection of exported interfaces
- `SchemaInterface`: Defines available functions
- `SchemaFunction`: Describes a function with its parameters
- `TypeDefinition`: Describes complex data types

### Type System

The application includes a sophisticated type system that:

- Handles primitive types (string, number, boolean, etc.)
- Supports complex types (records, variants, tuples, etc.)
- Provides appropriate input components for each type
- Generates default values based on type information

### Parameter Handling and Data Flow

The application processes parameters through several layers before sending them to the plugin:

1. **Parameter Initialization**:

   - When a function is selected in `PluginLoader`, parameters are initialized using the schema
   - Parameter names from the schema (e.g., `"public-key"`) are converted to camelCase (e.g., `"publicKey"`)
   - Initial values are generated based on parameter types using the `getTypeInfo` function

2. **User Input Handling**:

   - Input components (e.g., `StringInput`) capture user input via their `onChange` handlers
   - Changes flow to `RichParameterEditor.handleRichEdit()` which:
     - Updates the parameter values in the state object
     - Special handling exists for bytelist parameters (storing both bytes and rawInput)

3. **Parameter Storage**:

   - All parameter values are stored in the `paramValues` state in `PluginLoader`
   - Parameter keys are consistently in camelCase format
   - For bytelist parameters, additional entries with `*RawInput` suffixes store raw input values

4. **Parameter Processing for Execution**:

   - When executing a function, `ExecutionTabs.getCleanValues()` filters out any entries ending with `RawInput`
   - The `parseParams()` function converts the object to an array using `Object.values()`
   - Parameters are sent to the plugin function in the order they appear in the array

### Supervisor Integration

The application integrates with the psibase supervisor to:

- Authenticate users
- Load plugin schemas
- Execute plugin functions
- Handle responses

## Usage

The Plugin Tester is designed to be deployed as part of the psibase Common API and accessed through the `/common/plugin-tester/` path.

## Development

To run the application in development mode:

```bash
yarn dev
```

To build for production:

```bash
yarn build
```
