
add_library(psibase_net INTERFACE)
target_include_directories(psibase_net INTERFACE include)

if(DEFINED IS_NATIVE)
  add_subdirectory(test)
endif()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
