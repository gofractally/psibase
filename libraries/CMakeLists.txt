enable_testing()

if(DEFINED IS_NATIVE)
  add_subdirectory(triedent)
  add_subdirectory(arbtrie)
endif()

add_subdirectory(psio)
add_subdirectory(psibase)

if(DEFINED IS_NATIVE)
  add_subdirectory(debug_eos_vm)
  add_subdirectory(psibase_http)
  add_subdirectory(net)
endif()
