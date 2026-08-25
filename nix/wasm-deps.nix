# WASI builds of third-party libs used by wasm services.
# Inputs are the same tarballs as CMake; output layout matches build/wasm/deps.
{
  lib,
  stdenv,
  python3,
  perl,
  gnumake,
  zstd,
  gnugrep,
  gnutar,
  gzip,
  bzip2,
  wasiSdk,
  zlibTarball,
  gmpTarball,
  opensslTarball,
  botanTarball,
  sqliteTarball,
  boostTarball,
}:

stdenv.mkDerivation {
  pname = "psibase-wasm-deps";
  version = "0.27.0";

  dontUnpack = true;
  dontConfigure = true;
  dontFixup = true;
  dontStrip = true;
  hardeningDisable = [ "all" ];

  nativeBuildInputs = [
    python3
    perl
    gnumake
    zstd
    gnugrep
    gnutar
    gzip
    bzip2
  ];

  WASM_SYSROOT = "${wasiSdk}/share/wasi-sysroot";
  WASM_CC = "${wasiSdk}/bin/clang";
  WASM_CXX = "${wasiSdk}/bin/clang++";
  WASM_AR = "${wasiSdk}/bin/llvm-ar";
  WASM_RANLIB = "${wasiSdk}/bin/llvm-ranlib";

  buildPhase = ''
    runHook preBuild
    unset NIX_LDFLAGS NIX_LDFLAGS_BEFORE NIX_CFLAGS_LINK LD_LIBRARY_PATH
    unset NIX_CFLAGS_COMPILE NIX_CFLAGS_COMPILE_BEFORE CFLAGS CXXFLAGS LDFLAGS
    export PREFIX=$NIX_BUILD_TOP/deps
    mkdir -p "$PREFIX"
    jobs=''${NIX_BUILD_CORES:-1}
    sysroot=$WASM_SYSROOT
    cflags="--sysroot=$sysroot --target=wasm32-wasip1"

    echo "building zlib for wasm"
    tar xf ${zlibTarball} -C "$NIX_BUILD_TOP"
    pushd "$NIX_BUILD_TOP"/zlib-1.2.13
    export CC=$WASM_CC AR=$WASM_AR RANLIB=$WASM_RANLIB
    export CFLAGS="$cflags"
    ./configure --prefix="$PREFIX" --static
    make -j"$jobs"
    make install
    popd
    unset CFLAGS

    echo "building gmp for wasm"
    tar xf ${gmpTarball} -C "$NIX_BUILD_TOP"
    pushd "$NIX_BUILD_TOP"/gmp-6.2.1
    ./configure \
      CC=$WASM_CC \
      CFLAGS="$cflags -D_WASI_EMULATED_SIGNAL" \
      LDFLAGS=-lwasi-emulated-signal \
      --prefix="$PREFIX" \
      --host none \
      --disable-assembly
    make -j"$jobs"
    make install
    popd

    echo "building openssl for wasm"
    tar xf ${opensslTarball} -C "$NIX_BUILD_TOP"
    pushd "$NIX_BUILD_TOP"/openssl-3.0.7
    openssl_flags="$cflags -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -DNO_SYSLOG -DOPENSSL_NO_SECURE_MEMORY -Wno-error=implicit-function-declaration"
    perl Configure linux-generic32 \
      --prefix="$PREFIX" \
      no-afalgeng no-asm no-autoalginit no-autoerrinit no-autoload-config no-dso no-async no-shared no-sock no-tests no-threads no-ui \
      CC=$WASM_CC \
      CXX=$WASM_CXX \
      AR=$WASM_AR \
      RANLIB=$WASM_RANLIB \
      CFLAGS="$openssl_flags" \
      CXXFLAGS="$openssl_flags"
    make -j"$jobs" install_dev install_engines
    popd

    echo "building botan for wasm"
    tar xf ${botanTarball} -C "$NIX_BUILD_TOP"
    pushd "$NIX_BUILD_TOP"/Botan-3.1.1
    python3 configure.py \
      --cc-bin=$WASM_CXX \
      --cc=gcc \
      --cpu=generic \
      --os=none \
      --ar-command=$WASM_AR \
      --build-targets=static \
      --with-sysroot-dir=$sysroot \
      --minimized-build \
      --enable-modules=ecdsa,bcrypt,raw_hash,auto_rng,sha2_64,getentropy \
      --with-os-feature=getentropy \
      --cxxflags="--target=wasm32-wasip1 -O3 -msign-ext -mnontrapping-fptoint -mbulk-memory" \
      --without-stack-protector \
      --prefix="$PREFIX"
    make -j"$jobs"
    make install
    popd

    echo "extracting sqlite amalgamation"
    tar xf ${sqliteTarball} -C "$PREFIX"

    echo "extracting boost headers"
    mkdir -p "$PREFIX/boost"
    tar xf ${boostTarball} -C "$NIX_BUILD_TOP"
    cp -a "$NIX_BUILD_TOP"/boost_1_81_0 "$PREFIX/boost/boost_1_81_0"
    cp -a "$NIX_BUILD_TOP"/boost_1_81_0/boost "$PREFIX/boost/boost"

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp -a "$NIX_BUILD_TOP/deps/." "$out/"
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    for f in lib/libz.a lib/libgmp.a lib/libssl.a lib/libcrypto.a lib/libbotan-3.a \
             include/botan-3 sqlite-autoconf-3450200/sqlite3.c \
             boost/boost/version.hpp boost/boost_1_81_0/LICENSE_1_0.txt; do
      if [ ! -e "$out/$f" ]; then
        echo "missing $f" >&2
        exit 1
      fi
    done
    runHook postInstallCheck
  '';

  meta = {
    description = "WASI third-party libs for psibase wasm services";
    license = lib.licenses.mit;
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
  };
}
