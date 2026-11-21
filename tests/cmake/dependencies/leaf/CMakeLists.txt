# These invalid values must be ignored by FetchContent's first-declare-wins.
FetchContent_Declare(psio
    GIT_REPOSITORY https://invalid.example/this-must-never-be-fetched.git
    GIT_TAG this-must-never-be-selected
    SOURCE_DIR "${CMAKE_CURRENT_BINARY_DIR}/wrong-source")
FetchContent_MakeAvailable(psio)
if(NOT TARGET psio::psio)
    message(FATAL_ERROR "The diamond did not share canonical psio::psio")
endif()
