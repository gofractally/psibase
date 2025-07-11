# All cmake projects need these
cmake_minimum_required(VERSION 3.16)
project(example)

# Generate compile_commands.json to aid vscode and other editors
set(CMAKE_EXPORT_COMPILE_COMMANDS on)

# Libraries for building services and tests
find_package(psibase REQUIRED)

# Build example.wasm service
add_executable(example example.cpp)
target_link_libraries(example Psibase::service)

# Create a package
psibase_package(
    NAME Example
    VERSION 1.0.0
    DESCRIPTION "An example service"
    # The account that the service will run on
    SERVICE example
        # The CMake target that builds the service
        TARGET example
)
