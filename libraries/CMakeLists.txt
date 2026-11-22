enable_testing()

add_subdirectory(psio1)
add_subdirectory(psibase)

if(DEFINED IS_NATIVE)
  add_subdirectory(psibase_http)
  add_subdirectory(net)
endif()
