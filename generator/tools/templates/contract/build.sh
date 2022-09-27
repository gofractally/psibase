mkdir build
cd build
cmake `psidk-cmake-args` ..
make -j $(nproc)