include(${CMAKE_CURRENT_LIST_DIR}/pack_service.cmake)

set(result)
string(APPEND result "{")
json_append_list(result "flags" ${PSIBASE_FLAGS})
if (PSIBASE_SERVER)
    json_append_key(result "server" ${PSIBASE_SERVER})
endif()
if(PSIBASE_SCHEMA)
    string(APPEND result ",\"schema\":")
    file(READ ${PSIBASE_SCHEMA} schema)
    string(APPEND result ${schema})
endif()

string(APPEND result "}")

file(WRITE ${PSIBASE_OUTPUT} ${result})
