enable_testing()

add_library( psio src/chrono.cpp src/fpconv.c src/schema.cpp src/from_json.cpp)
target_link_libraries( psio PUBLIC rapidjson boost )
target_include_directories( psio PUBLIC include )
add_compile_options( -Wall -Wstrict-aliasing )

target_sources( psio INTERFACE
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/fpconv.h
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/powers.h
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/compress.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/check.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/reflect.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/schema.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/stream.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_key.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/tuple.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/fracpack.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_json.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_json/map.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/json/any.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_bin.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_bin/map.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_bin/set.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_bin/list.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/to_bin/deque.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/from_bin.hpp
        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/from_json.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/varint.hpp

        ${CMAKE_CURRENT_SOURCE_DIR}/include/psio/bytes.hpp
)

add_subdirectory(tests)

if(IS_WASM)
    target_link_libraries(psio PRIVATE wasm-base)
    target_include_directories(psio PUBLIC ../psibase/common/include)
    install(DIRECTORY include/psio TYPE INCLUDE COMPONENT libpsibase FILES_MATCHING PATTERN "*.hpp" PATTERN "*.h")
    install(TARGETS psio ARCHIVE COMPONENT libpsibase)
endif()
