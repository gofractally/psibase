set(SQLITE3_ARCHIVE sqlite-autoconf-3450200.tar.gz)
set(SQLITE3_EXTRACTED sqlite-autoconf-3450200)
set(SQLITE3_SHA256 bc9067442eedf3dd39989b5c5cfbfff37ae66cc9c99274e0c3052dc4d4a8f6ae)

if(NOT EXISTS ${DEP_PREFIX}/${SQLITE3_EXTRACTED}/sqlite3.c)
    download(${DEP_URL}/${SQLITE3_ARCHIVE} ${DEP_PREFIX}/${SQLITE3_ARCHIVE} ${SQLITE3_SHA256})
    execute_process(
        WORKING_DIRECTORY ${DEP_PREFIX}
        COMMAND tar xf ${SQLITE3_ARCHIVE}
    )
endif()

add_library(sqlite3 src/os.cpp ${DEP_PREFIX}/${SQLITE3_EXTRACTED}/sqlite3.c)
target_include_directories(sqlite3 PUBLIC ${DEP_PREFIX}/${SQLITE3_EXTRACTED})
target_compile_definitions(sqlite3 PRIVATE SQLITE_OS_OTHER=1)
target_link_libraries(sqlite3 PRIVATE wasm-base)
