cmake_minimum_required(VERSION 3.20)
project(psibase_artifact_codec LANGUAGES C CXX)
# A separate CMake target graph prevents the legacy target named psio from
# satisfying the canonical artifact codec's dependency by accident.
include("${PSIBASE_SOURCE_DIR}/cmake/PsibaseDependencies.cmake")
psibase_acquire_dependency(psio)
add_subdirectory("${PSIZAM_SOURCE_DIR}/cmake/ArtifactCodec" codec)
