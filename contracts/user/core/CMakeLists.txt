
function(add suffix)
      add_library(contracts-core${suffix} SharedAccount/src/SharedAccount.cpp)
      target_include_directories(contracts-core${suffix} PUBLIC SharedAccount/include )
      target_link_libraries(contracts-core${suffix} contracts_system${suffix})
endfunction(add)

add("")
add("-debug")

set(CMAKE_EXPORT_COMPILE_COMMANDS on)