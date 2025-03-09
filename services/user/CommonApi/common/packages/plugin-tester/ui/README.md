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

## Data Flow

1. The application loads the current service information on startup
2. Users can specify a service and plugin to load
3. The schema is fetched using the `usePluginSchema` hook
4. Available functions are displayed in the `FunctionSelector`
5. When a function is selected, parameter inputs are generated based on the function's schema
6. Users can fill in parameter values using type-appropriate input components
7. The `ExecutionTabs` component handles function execution and displays results

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
