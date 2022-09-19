FROM ubuntu:18.04

RUN export DEBIAN_FRONTEND=noninteractive \
 && apt-get update \
 && apt-get install -yq software-properties-common \
 && add-apt-repository -y ppa:ubuntu-toolchain-r/test \
 && apt-get update \
 && apt-get install -yq \
        autoconf                            \
        build-essential                     \
        curl                                \
        g++-11                              \
        gcc-11                              \
        gcc-multilib                        \
        git                                 \
        libcurl4-openssl-dev                \
        libgbm-dev                          \
        libgmp-dev                          \
        libmpc-dev                          \
        libmpfr-dev                         \
        libssl-dev                          \
        libstdc++-11-dev                    \
        libtool                             \
        libzstd-dev                         \
        pkg-config                          \
        python                              \
        texinfo                             \
        zstd                                \
 && apt-get clean -yq \
 && rm -rf /var/lib/apt/lists/*

RUN cd /root \
 && curl -LO https://github.com/Kitware/CMake/releases/download/v3.24.0/cmake-3.24.0.tar.gz \
 && tar xf cmake-3.24.0.tar.gz \
 && cd /root/cmake-3.24.0 \
 && ./bootstrap --parallel=`nproc` -- \
 && make -j `nproc` \
 && make install -j `nproc` \
 && cd /root \
 && rm -rf cmake-*

RUN cd /root \
 && curl -LO https://github.com/ccache/ccache/releases/download/v4.3/ccache-4.3.tar.gz \
 && tar xf ccache-4.3.tar.gz \
 && cd /root/ccache-4.3 \
 && cmake -DZSTD_FROM_INTERNET=On . \
 && make -j `nproc` \
 && make -j `nproc` install \
 && cd /root \
 && rm -rf ccache*

# http://mirror.rit.edu/gnu/gcc/gcc-11.3.0/gcc-11.3.0.tar.gz
#RUN cd /root \
# && curl -LO https://github.com/gofractally/container-builders/releases/download/v0.0-dep/gcc-11.3.0.tar.gz \
# && tar xf gcc-11.3.0.tar.gz \
# && mkdir build-gcc \
# && cd /root/build-gcc \
# && /root/gcc-11.3.0/configure --prefix=/usr/local --enable-languages=c,c++ --disable-bootstrap \
#    --program-suffix=-11 \
# && make -j `nproc` \
# && make -j `nproc` install \
# && cd /root \
# && rm -rf *gcc*

RUN update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-11 100 \
 && update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-11 100 \
 && update-alternatives --install /usr/bin/cc cc /usr/bin/gcc-11 100 \
 && update-alternatives --install /usr/bin/c++ c++ /usr/bin/g++-11 100

RUN cd /opt \
    && curl -LO https://github.com/llvm/llvm-project/releases/download/llvmorg-14.0.0/clang+llvm-14.0.0-x86_64-linux-gnu-ubuntu-18.04.tar.xz \
    && tar xf clang+llvm-14.0.0-x86_64-linux-gnu-ubuntu-18.04.tar.xz \
    && rm clang+llvm-14.0.0-x86_64-linux-gnu-ubuntu-18.04.tar.xz

RUN cd /root \
 && curl -LO https://github.com/gofractally/container-builders/releases/download/v0.0-dep/boost_1_78_0.tar.gz \
 && tar xf boost_1_78_0.tar.gz \
 && cd boost_1_78_0 \
 && ./bootstrap.sh \
 && ./b2 --prefix=/usr/local --build-dir=build variant=release --with-chrono --with-date_time \
         --with-filesystem --with-iostreams --with-program_options --with-system --with-test \
         -sNO_ZSTD=1 install \
 && cd /root \
 && rm -rf boost*

RUN cd /opt \
 && curl -LO https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-14/wasi-sdk-14.0-linux.tar.gz \
 && tar xf wasi-sdk-14.0-linux.tar.gz \
 && curl -LO https://nodejs.org/dist/v16.17.0/node-v16.17.0-linux-x64.tar.xz \
 && tar xf node-v16.17.0-linux-x64.tar.xz \
 && rm *.tar.* \
 && export PATH="/opt/node-v16.17.0-linux-x64/bin:$PATH" \
 && npm i -g yarn

ENV RUSTUP_HOME=/opt/rustup
ENV CARGO_HOME=/opt/cargo

RUN cd /root \
 && curl --proto '=https' --tlsv1.2 -sSf -o rustup.sh https://sh.rustup.rs \
 && chmod 700 rustup.sh \
 && ./rustup.sh -y --no-modify-path \
 && /opt/cargo/bin/cargo install mdbook mdbook-linkcheck mdbook-mermaid sccache  \
 && chmod -R 777 $RUSTUP_HOME \
 && chmod -R 777 $CARGO_HOME \
 && rm rustup.sh

RUN cd /usr \
 && curl -LO https://github.com/WebAssembly/binaryen/releases/download/version_109/binaryen-version_109-x86_64-linux.tar.gz \
 && tar xf binaryen-version_109-x86_64-linux.tar.gz --strip-components=1

ENV WASI_SDK_PREFIX=/opt/wasi-sdk-14.0
ENV PATH=/opt/cargo/bin:/opt/node-v16.17.0-linux-x64/bin:/opt/clang+llvm-14.0.0-x86_64-linux-gnu-ubuntu-18.04/bin:$PATH
ENV LD_LIBRARY_PATH=/opt/clang+llvm-14.0.0-x86_64-linux-gnu-ubuntu-18.04/lib
