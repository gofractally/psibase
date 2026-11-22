enable_testing()

add_library( psio1 src/chrono.cpp src/fpconv.c src/schema.cpp src/from_json.cpp)
target_link_libraries( psio1 PUBLIC rapidjson boost )
target_include_directories( psio1 PUBLIC include )
add_compile_options( -Wall -Wstrict-aliasing )

target_sources( psio1 INTERFACE
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio1/fpconv.h
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio1/powers.h
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio1/check.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio1/reflect.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio1/schema.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio1/stream.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio1/to_key.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio1/tuple.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio1/fracpack.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio1/to_json.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio1/to_json/map.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio1/json/any.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio1/to_bin.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio1/from_bin.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio1/from_json.hpp
)

add_subdirectory(tests)

if(IS_WASM)
    target_link_libraries(psio1 PRIVATE wasm-base)
    target_include_directories(psio1 PUBLIC ../psibase/common/include)
    install(DIRECTORY include/psio1 TYPE INCLUDE COMPONENT libpsibase FILES_MATCHING PATTERN "*.hpp" PATTERN "*.h")
    install(TARGETS psio1 ARCHIVE COMPONENT libpsibase)
endif()
