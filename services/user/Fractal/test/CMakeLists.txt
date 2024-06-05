# Temporarily eliminating the test until it can be rewritted 
#   to use SubjectPublicKeyInfo for the pubkeys.
#add_user_test_debug(Fractal src/Fractal-test.cpp)
add_user_test_debug(manualFractalTest src/manual-fractal-test.cpp)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
