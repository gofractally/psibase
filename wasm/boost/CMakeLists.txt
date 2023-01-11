set(BOOST_URL https://github.com/gofractally/psibase/releases/download/deps/boost_1_81_0.tar.bz2)
set(BOOST_ARCHIVE ${CMAKE_CURRENT_BINARY_DIR}/boost_1_81_0.tar.bz2)
set(BOOST_EXTRACTED ${CMAKE_CURRENT_BINARY_DIR}/boost_1_81_0)
set(BOOST_SHA256 71feeed900fbccca04a3b4f2f84a7c217186f28a940ed8b7ed4725986baf99fa)
set(BOOST_BOOST ${CMAKE_CURRENT_BINARY_DIR}/boost)

if(NOT EXISTS ${BOOST_ARCHIVE})
    message("Downloading ${BOOST_URL}")
    file(DOWNLOAD ${BOOST_URL} ${BOOST_ARCHIVE}
        STATUS BOOST_DOWNLOAD_STATUS
        TIMEOUT 600
        SHOW_PROGRESS
        EXPECTED_HASH SHA256=${BOOST_SHA256}
        TLS_VERIFY ON)
    list(POP_BACK BOOST_DOWNLOAD_STATUS BOOST_DOWNLOAD_STATUS_MSG)
    if(NOT BOOST_DOWNLOAD_STATUS EQUAL 0)
        file(REMOVE ${BOOST_ARCHIVE})
        message(FATAL_ERROR "Download ${BOOST_URL} failed. ${BOOST_DOWNLOAD_STATUS_MSG}")
    endif()
endif()

if(NOT EXISTS ${BOOST_EXTRACTED})
    message("Extracting ${BOOST_ARCHIVE}")
    execute_process(
        WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
        COMMAND tar xf ${BOOST_ARCHIVE}
    )
endif()

if(NOT EXISTS ${BOOST_BOOST})
    message("Copying ${BOOST_BOOST}")
    execute_process(
        WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
        COMMAND cp -a ${BOOST_EXTRACTED}/boost ${BOOST_BOOST}
    )
endif()

add_library(boost INTERFACE)
target_mapped_include_directories(boost INTERFACE ${CMAKE_CURRENT_BINARY_DIR})

include(GNUInstallDirs)
install(DIRECTORY ${BOOST_BOOST} TYPE INCLUDE COMPONENT libpsibase)
install(FILES ${BOOST_EXTRACTED}/LICENSE_1_0.txt DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/licenses RENAME LICENSE.boost COMPONENT libpsibase)
