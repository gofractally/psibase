cmake_policy(VERSION 3.16.3...3.31.6)

function(json_append_string VAR VALUE)
    set(initial ${${VAR}})
    string(REGEX REPLACE "([\\\"])" "\\\\\\1" result ${VALUE})
    string(REGEX REPLACE "\n" "\\\\n" result ${result})
    set(${VAR} "${initial}\"${result}\"" PARENT_SCOPE)
endfunction()

function(json_append_comma VAR)
    if(NOT (${${VAR}} MATCHES "[[{]$"))
        set(${VAR} "${${VAR}}," PARENT_SCOPE)
    endif()
endfunction()

macro(json_append_key VAR KEY VALUE)
    json_append_comma(${VAR})
    json_append_string(${VAR} ${KEY})
    string(APPEND ${VAR} ":")
    json_append_string(${VAR} ${VALUE})
endmacro()

function(json_append_list VAR KEY)
    set(result ${${VAR}})
    json_append_comma(result)
    json_append_string(result ${KEY})
    string(APPEND result ":")
    string(APPEND result "[")
    foreach(item IN LISTS ARGN)
        json_append_comma(result)
        json_append_string(result ${item})
    endforeach()
    string(APPEND result "]")
    set(${VAR} ${result} PARENT_SCOPE)
endfunction()

function(split_name_version PACKAGE NAME_VAR VERSION_VAR)
    if(PACKAGE MATCHES "^([^(]*)\\\((.*)\\\)$")
        set(${NAME_VAR} ${CMAKE_MATCH_1} PARENT_SCOPE)
        set(${VERSION_VAR} ${CMAKE_MATCH_2} PARENT_SCOPE)
    elseif(PACKAGE MATCHES "^(.*)-([0-9]+\\.[0-9]+\\.[0-9]+([-+].*)?)$")
        set(${NAME_VAR} ${CMAKE_MATCH_1} PARENT_SCOPE)
        set(${VERSION_VAR} =${CMAKE_MATCH_2} PARENT_SCOPE)
    else()
        set(${NAME_VAR} ${PACKAGE} PARENT_SCOPE)
        set(${VERSION_VAR} "*" PARENT_SCOPE)
    endif()
endfunction()

function(json_append_deps VAR KEY)
    set(result ${${VAR}})
    json_append_comma(result)
    json_append_string(result ${KEY})
    string(APPEND result ":")
    string(APPEND result "[")
    foreach(item IN LISTS ARGN)
        split_name_version(${item} name version)
        json_append_comma(result)
        string(APPEND ${VAR} "{")
        json_append_string(result "name")
        string(APPEND ${VAR} ":")
        json_append_string(result ${name})
        string(APPEND ${VAR} ",")
        json_append_string(result "version")
        string(APPEND ${VAR} ":")
        json_append_string(result ${version})
        string(APPEND ${VAR} "}")
    endforeach()
    string(APPEND result "]")
    set(${VAR} ${result} PARENT_SCOPE)
endfunction()

function(write_meta)
    cmake_parse_arguments(PARSE_ARGV 0 "" "" "NAME;VERSION;DESCRIPTION;OUTPUT" "DEPENDS;ACCOUNTS")
    set(result)
    string(APPEND result "{")
    json_append_key(result "name" ${_NAME})
    json_append_key(result "version" ${_VERSION})
    json_append_key(result "description" ${_DESCRIPTION})
    json_append_deps(result "depends" ${_DEPENDS})
    json_append_list(result "accounts" ${_ACCOUNTS})
    string(APPEND result "}")
    file(GENERATE OUTPUT ${_OUTPUT} CONTENT ${result})
endfunction()

function(write_service_info)
    cmake_parse_arguments(PARSE_ARGV 0 "" "" "SERVER;OUTPUT;SCHEMA" "FLAGS")
    add_custom_command(
        OUTPUT ${_OUTPUT}
        DEPENDS ${CMAKE_CURRENT_FUNCTION_LIST_DIR}/generate_service_info.cmake ${_SCHEMA}
        COMMAND ${CMAKE_COMMAND} -DPSIBASE_OUTPUT=${_OUTPUT} -DPSIBASE_SERVER=${_SERVER} "-DPSIBASE_FLAGS=${_FLAGS}" -DPSIBASE_SCHEMA=${_SCHEMA} -P ${CMAKE_CURRENT_FUNCTION_LIST_DIR}/generate_service_info.cmake
        VERBATIM
    )
endfunction()

# NAME <name>               - The name of the package
# VERSION <version>         - The package version
# DESCRIPTION <text>        - The package description
# OUTPUT <filename>         - The package file. Defaults to ${NAME}.psi
# ACCOUNTS <name>...        - Additional non-service accounts to create
# DEPENDS <targets>...      - Targets that this target depends on
# PACKAGE_DEPENDS <name>... - Other psibase packages that the package depends on
# SERVICE <name>            - The account name of a service
#   TARGET <target>         - The wasm file that will be deployed
#   WASM <filename>         - The wasm file that will be deployed
#   FLAGS <flags>...        - Flags to set on the service account (requires chain admin powers to install)
#   SERVER <name>           - The service that handles HTTP requests
#   DATA <path> <dest>      - Uploads a file or directory to the target location
#   DATA GLOB <path>... <dir> - Uploads multiple files to a directory
#   INIT                    - The service has an init action that should be run with no arguments
#   POSTINSTALL <filename>  - Additional actions that should be run at the end of installation
function(psibase_package)
    set(keywords NAME VERSION DESCRIPTION OUTPUT PACKAGE_DEPENDS DEPENDS ACCOUNTS SERVICE DATA TARGET WASM FLAGS SERVER INIT POSTINSTALL SCHEMA)
    foreach(keyword IN LISTS keywords)
        set(_${keyword})
    endforeach()
    set(_SERVICES)
    foreach(arg IN LISTS ARGN)
        set(my_keyword)
        foreach(keyword IN LISTS keywords)
            if (arg STREQUAL keyword)
                set(my_keyword ${keyword})
            endif()
        endforeach()
        if(my_keyword)
            if(current_keyword STREQUAL "DATA")
                list(APPEND _DATA_${_SERVICE} DATA)
            endif()
            if (my_keyword STREQUAL "INIT")
                set(_INIT_${_SERVICE} TRUE)
                set(current_keyword)
            else()
                set(current_keyword ${my_keyword})
            endif()
        else()
            if(current_keyword STREQUAL "NAME")
                set(_NAME ${arg})
            elseif(current_keyword STREQUAL "VERSION")
                set(_VERSION ${arg})
            elseif(current_keyword STREQUAL "DESCRIPTION")
                set(_DESCRIPTION ${arg})
            elseif(current_keyword STREQUAL "OUTPUT")
                set(_OUTPUT ${arg})
            elseif(current_keyword STREQUAL "DEPENDS")
                list(APPEND _DEPENDS ${arg})
            elseif(current_keyword STREQUAL "PACKAGE_DEPENDS")
                list(APPEND _PACKAGE_DEPENDS ${arg})
            elseif(current_keyword STREQUAL "ACCOUNTS")
                list(APPEND _ACCOUNTS ${arg})
            elseif(current_keyword STREQUAL "SERVICE")
                set(_SERVICE ${arg})
                list(APPEND _SERVICES ${_SERVICE})
                set(_DATA_${_SERVICE})
                set(_WASM_${_SERVICE})
                set(_FLAGS_${_SERVICE})
                set(_SERVER_${_SERVICE})
                set(_INIT_${_SERVICE})
            elseif(current_keyword STREQUAL "DATA")
                list(APPEND _DATA_${_SERVICE} ${arg})
            elseif(current_keyword STREQUAL "TARGET")
                set(_TARGET_${_SERVICE} ${arg})
            elseif(current_keyword STREQUAL "WASM")
                set(_WASM_${_SERVICE} ${arg})
            elseif(current_keyword STREQUAL "FLAGS")
                list(APPEND _FLAGS_${_SERVICE} ${arg})
            elseif(current_keyword STREQUAL "SERVER")
                set(_SERVER_${_SERVICE} ${arg})
            elseif(current_keyword STREQUAL "SCHEMA")
                set(_SCHEMA_${_SERVICE} ${arg})
            elseif(current_keyword STREQUAL "POSTINSTALL")
                set(_POSTINSTALL ${arg})
            else()
                message(FATAL_ERROR "Invalid arguments to psibase_package")
            endif()
        endif()
    endforeach()
    if(NOT _NAME)
        message(FATAL_ERROR "missing NAME")
    endif()
    if(NOT _VERSION)
        message(FATAL_ERROR "missing VERSION for ${_NAME}")
    endif()
    if(NOT _DESCRIPTION)
        set(_DESCRIPTION "${_NAME}")
    endif()
    if(NOT _OUTPUT)
        set(_OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/${_NAME}.psi)
    endif()
    set(outdir ${CMAKE_CURRENT_BINARY_DIR}/CMakeFiles/${_NAME}.psi.tmp)
    set(copy-contents)
    set(contents meta.json)
    set(zip-deps ${outdir}/meta.json)
    set(init-services)
    foreach(service IN LISTS _SERVICES)
        if(_WASM_${service} OR _TARGET_${service})
            if(NOT _SCHEMA_${service})
                if(_TARGET_${service})
                    set(_SCHEMA_${service} ${CMAKE_CURRENT_BINARY_DIR}/${service}-schema.json)
                    psibase_schema(${_TARGET_${service}} ${_SCHEMA_${service}})
                else()
                    message(FATAL_ERROR "Missing schema for ${service}")
                endif()
            endif()
            write_service_info(
                OUTPUT ${outdir}/service/${service}.json
                FLAGS ${_FLAGS_${service}}
                SERVER ${_SERVER_${service}}
                SCHEMA ${_SCHEMA_${service}}
            )
            list(APPEND zip-deps ${outdir}/service/${service}.json)
            if(_INIT_${service})
                list(APPEND init-services ${service})
            endif()
            if (_TARGET_${service})
                set(wasm $<TARGET_FILE:${_TARGET_${service}}>)
                list(APPEND zip-deps ${_TARGET_${service}})
            else()
                set(wasm ${_WASM_${service}})
                list(APPEND zip-deps ${wasm})
            endif()
            list(APPEND copy-contents COMMAND ln -f ${wasm} ${outdir}/service/${service}.wasm)
            list(APPEND contents service/${service}.wasm service/${service}.json)
        endif()
        if(_DATA_${service})
            set(commands)
            set(dirs)
            set(last)
            set(current_group)
            set(is_glob)
            if (APPLE)
                set(hardlink-opt)
            else()
                set(hardlink-opt -l)
            endif()
            foreach(item IN ITEMS ${_DATA_${service}} DATA)
                if(item STREQUAL "DATA")
                    if (last MATCHES "^/")
                        set(dest ${outdir}/data/${service}${last})
                    else()
                        set(dest ${outdir}/data/${service}/${last})
                    endif()
                    list(LENGTH last n)
                    if(n GREATER 0)
                        string(JOIN " " current_group ${current_group})
                        if(is_glob)
                            list(APPEND commands COMMAND bash -c "cp -r ${hardlink-opt} ${current_group} ${dest}")
                            list(APPEND dirs ${dest})
                        else()
                            string(REGEX REPLACE "/$" "" dest ${dest})
                            list(APPEND commands COMMAND cp -r ${hardlink-opt} ${current_group} ${dest})
                            list(APPEND zip-deps ${current_group})
                            string(REGEX REPLACE "/[^/]+$" "" parent ${dest})
                            list(APPEND dirs ${parent})
                        endif()
                    endif()
                    set(last)
                    set(current_group)
                    set(is_glob)
                elseif(item STREQUAL "GLOB")
                    set(is_glob 1)
                else()
                    list(APPEND current_group ${last})
                    set(last ${item})
                endif()
            endforeach()
            list(APPEND copy-contents
                COMMAND ${CMAKE_COMMAND} -E make_directory ${dirs}
                ${commands})
            list(APPEND contents data/${service})
        endif()
    endforeach()

    if(init-services)
        if(_POSTINSTALL)
            message(FATAL_ERROR "Merging INIT with POSTINSTALL not implemented")
        endif()
        set(postinstall "[")
        foreach(service IN LISTS init-services)
            json_append_comma(postinstall)
            string(APPEND postinstall "{")
            json_append_key(postinstall sender ${service})
            json_append_key(postinstall service ${service})
            json_append_key(postinstall method init)
            json_append_key(postinstall rawData "0000")
            string(APPEND postinstall "}")
        endforeach()
        string(APPEND postinstall "]")
        file(GENERATE OUTPUT ${outdir}/script/postinstall.json CONTENT ${postinstall})
        list(APPEND contents script/postinstall.json)
        list(APPEND zip-deps ${outdir}/script/postinstall.json)
    elseif(_POSTINSTALL)
        list(APPEND copy-contents
            COMMAND ${CMAKE_COMMAND} -E make_directory ${outdir}/script
            COMMAND ln -f ${_POSTINSTALL} ${outdir}/script/postinstall.json)
        list(APPEND contents script/postinstall.json)
        list(APPEND zip-deps ${_POSTINSTALL})
    endif()

    write_meta(
        OUTPUT ${outdir}/meta.json
        NAME ${_NAME}
        VERSION ${_VERSION}
        DESCRIPTION ${_DESCRIPTION}
        ACCOUNTS ${_ACCOUNTS} ${_SERVICES}
        DEPENDS ${_PACKAGE_DEPENDS}
    )
    string(REGEX REPLACE "/[^/]+/?$" "" output-dir ${_OUTPUT})
    add_custom_command(
        OUTPUT ${_OUTPUT}
        DEPENDS ${zip-deps} ${_DEPENDS}
        WORKING_DIRECTORY ${outdir}
        COMMAND ${CMAKE_COMMAND} -E make_directory ${output-dir}
        COMMAND ${CMAKE_COMMAND} -E remove -f ${_OUTPUT}
        COMMAND ${CMAKE_COMMAND} -E remove_directory ${outdir}/data
        ${copy-contents}
        COMMAND cd ${outdir} && ${CMAKE_COMMAND} -E tar cf ${_OUTPUT} --format=zip ${contents}
    )
    add_custom_target(${_NAME} ALL DEPENDS ${_OUTPUT})
endfunction()

# Description:              - Use this function when you want to add additional details to a package that is 
#                             built/managed by cargo-psibase, as opposed to packages built entirely using CMake.
# OUTPUT <filename>         - [Required] The package file. Must be identical to 'package.metadata.psibase.package-name' in project's Cargo.toml
# PATH <filepath>           - [Required] The path to the cargo workspace (e.g. `services/user/Branding`).
# DEPENDS <targets>...      - Targets that this target depends on
function(cargo_psibase_package)
    cmake_parse_arguments(ARG "" "PATH;OUTPUT;DEPENDS" "" ${ARGN})

    if(NOT ARG_PATH OR NOT ARG_OUTPUT)
        message(FATAL_ERROR "Both PATH and OUTPUT must be specified for cargo_psibase_package")
    endif()

    # Set variables
    get_filename_component(PACKAGE_NAME ${ARG_OUTPUT} NAME)
    get_filename_component(TARGET_NAME ${ARG_OUTPUT} NAME_WE)
    
    # Use hardcoded shared cache directory for services workspace
    # All services now use the shared cache at /root/psibase/.caches/target-shared
    set(PACKAGE_OUTPUT ${CMAKE_CURRENT_SOURCE_DIR}/.caches/target-shared/wasm32-wasip1/release/packages/${PACKAGE_NAME})

    # Build the package if needed
    ExternalProject_Add(${TARGET_NAME}_ext
        SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/${ARG_PATH}
        BUILD_BYPRODUCTS ${PACKAGE_OUTPUT}
        CONFIGURE_COMMAND ""
        BUILD_COMMAND ${CMAKE_CURRENT_BINARY_DIR}/rust/release/cargo-psibase package
            --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/${ARG_PATH}/Cargo.toml
        INSTALL_COMMAND ""
        BUILD_ALWAYS 1
        DEPENDS ${ARG_DEPENDS} cargo-psibase psitest
    )

    add_custom_command(
        OUTPUT ${ARG_OUTPUT}
        COMMAND ${CMAKE_COMMAND} -E copy_if_different ${PACKAGE_OUTPUT} ${ARG_OUTPUT}
        DEPENDS ${PACKAGE_OUTPUT}
        DEPENDS ${TARGET_NAME}_ext
        VERBATIM
    )
    add_custom_target(${TARGET_NAME} ALL DEPENDS ${ARG_OUTPUT} cargo-psibase)
endfunction()

function(psibase_schema target)
    add_executable(${target}-schema-gen $<TARGET_PROPERTY:${target},SOURCES>)
    target_compile_definitions(${target}-schema-gen PRIVATE $<TARGET_PROPERTY:${target},COMPILE_DEFINITIONS> PSIBASE_GENERATE_SCHEMA)
    target_compile_options(${target}-schema-gen PRIVATE $<TARGET_PROPERTY:${target},COMPILE_OPTIONS>)
    target_include_directories(${target}-schema-gen PRIVATE $<TARGET_PROPERTY:${target},INCLUDE_DIRECTORIES>)
    if (TARGET psitestlib)
        target_link_libraries(${target}-schema-gen PRIVATE "$<FILTER:$<TARGET_PROPERTY:${target},LINK_LIBRARIES>,EXCLUDE,.*(psibase-service).*>" psitestlib)
    else()
        target_link_libraries(${target}-schema-gen PRIVATE "$<FILTER:$<TARGET_PROPERTY:${target},LINK_LIBRARIES>,EXCLUDE,.*(Psibase::service).*>" Psibase::test)
    endif()

    if(ARGC GREATER_EQUAL 2)
        set(_OUTFILE ${ARGV1})
    else()
        set(_OUTFILE $<TARGET_PROPERTY:${target},RUNTIME_OUTPUT_DIRECTORY>/${target}-schema.json)
    endif()

    add_custom_command(
        OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/${target}-schema.json.stamp
        DEPENDS ${target}
        COMMAND ${PSITEST_EXECUTABLE} $<TARGET_FILE:${target}-schema-gen> --schema > ${_OUTFILE}
        COMMAND touch ${CMAKE_CURRENT_BINARY_DIR}/${target}-schema.json.stamp
    )
    add_custom_target(${target}-schema ALL DEPENDS ${CMAKE_CURRENT_BINARY_DIR}/${target}-schema.json.stamp)
endfunction()
