# Layered build of the psibase SDK.
#
# One Cargo or CMake build per workspace, then one zip per .psi.
# Heavy builders use 2 jobs. Build the top target with --max-jobs 1.
#
#   wasm-sysroot -> cpp-wasm ----+
#   native ----------------------+-> pack -> psibase
#   rust-host -> plugins --------+
#             -> user-services --+
#             -> system-services +
#   yarn-cache -> ui ------------+
#   book ------------------------+
{ pkgs
, src
, rustToolchain
, wasiSdk
, cargoComponent
, nodejs24
, yarnBerry
, mdbook
, mdbookMermaid
, mdbookPagetoc
, mdbookPlugins
, mdbookLinkcheck
, llvmPackages
, boostForCMake
}:

let
  inherit (pkgs) lib stdenv;
  jobs = 2;
  fakeHash = lib.fakeHash;
  depUrl = "https://github.com/gofractally/psibase/releases/download/deps";
  version = "0.29.0";

  fetchDep = name: hash: pkgs.fetchurl {
    url = "${depUrl}/${name}";
    inherit hash;
  };

  catch2Src = pkgs.fetchgit {
    url = "https://github.com/catchorg/Catch2.git";
    rev = "2b60af89e23d28eefc081bc930831ee9d45ea58b";
    hash = "sha256-blhSdtNXwe4wKPVKlopsE0omgikMdl12JjwqASwJM2w=";
  };
  eosVmSrc = pkgs.fetchgit {
    url = "https://github.com/gofractally/eos-vm.git";
    rev = "1c8814448ea3cacf6c345579745f06343642f553";
    hash = "sha256-9yVYsyQNb2cD+NvaFO22GigDQp9ensaEZgs7fi6B7no=";
    fetchSubmodules = true;
  };
  rapidjsonSrc = pkgs.fetchgit {
    url = "https://github.com/Tencent/rapidjson.git";
    rev = "663f076c7b44ce96526d1acfda3fa46971c8af31";
    hash = "sha256-Rwtl592JWvmec7e4cAe5VsLDO2UL8PJ0vLL/PbQQCaA=";
    fetchSubmodules = true;
  };

  htmSrc = pkgs.fetchurl {
    url = "https://unpkg.com/htm@3.1.0/dist/htm.module.js";
    hash = "sha256-qzPdPzgFm5vk1fU1ASju+yNWY5xOC76dnos7p1hH6eQ=";
  };
  reactSrc = pkgs.fetchurl {
    url = "https://unpkg.com/react@18/umd/react.production.min.js";
    hash = "sha256-2Unxw2h67a3O2shSYYZfKbF80nOZfn9rK/xTsvnUxN0=";
  };
  reactDomSrc = pkgs.fetchurl {
    url = "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js";
    hash = "sha256-NfT5dPSyvNRNpzljNH+JUuNB+DkJ5EmCJ9Tia5j2bw0=";
  };

  zlibSrc = fetchDep "zlib-1.2.13.tar.gz" "sha256-s6JN6XqP28g1uYMxaVAQMLiXcDG8tUs7OsE3QPhGqzA=";
  opensslSrc = fetchDep "openssl-3.0.7.tar.gz" "sha256-gwSdBComDmlvYkBqxcCL9wb9hDg/lFzyG9YentlcOW4=";
  sqliteSrc = fetchDep "sqlite-autoconf-3450200.tar.gz" "sha256-vJBnRC7t8905mJtcXPv/83rmbMnJknTgwwUtxNSo9q4=";
  boostTarball = fetchDep "boost_1_81_0.tar.bz2" "sha256-cf7u2QD7zMoEo7Ty+Ep8IXGG8oqUDti37UclmGuvmfo=";
  botanSrc = fetchDep "Botan-3.1.1.tar.xz" "sha256-MMhP6RmTapj+9TMfJGxiqiwOTSCFstRREgf2ogr6Oms=";

  uiProjects = [
    "packages/user/CommonApi/common/packages/common-lib"
    "packages/user/Host/LoginPrompt/ui"
    "packages/user/Evaluations/ui"
    "packages/user/Fractals/ui"
    "packages/user/FractalCore/ui"
    "packages/user/TokenStream/ui"
    "packages/user/CommonApi/common/packages/plugin-tester/ui"
    "packages/user/Explorer/ui"
    "packages/user/Homepage/ui"
    "packages/user/Identity/ui"
    "packages/user/Permissions/ui"
    "packages/user/Supervisor/ui"
    "packages/user/Workshop/ui"
    "packages/user/Config/ui"
    "packages/local/XAdmin/ui"
    "packages/local/XProxy/ui"
  ];

  psiNames = [
    "Accounts" "AccountsService" "Aes" "AuthAny" "AuthNone" "AuthDyn"
    "AuthDelegate" "AuthDelegateService" "AuthRecover" "AuthSig" "AuthSigService"
    "Base64" "Branding" "BrotliCodec" "BrotliSvc" "Chainmail" "ClientData"
    "CommonApi" "CpuLimit" "Credentials" "Db" "DevDefault" "ProdDefault"
    "ProdWithFG" "PrivDefault" "Docs" "DiffAdjust" "DynLd" "Events" "EventsService"
    "Evaluations" "FaucetTok" "Fractals" "FractalCore" "FractalGen" "FractalTester"
    "Guilds" "Explorer" "Host" "HostLoginPrompt" "Identity" "Invite" "InviteService"
    "Kdf" "Kvtests" "Nft" "Nop" "Minimal" "Packages" "Permissions" "Producers"
    "Profiles" "SingleProd" "TestDefault" "HttpServer" "Registry" "Sites" "SetCode"
    "StagedTx" "Subgroups" "Supervisor" "Symbol" "TokenUsers" "Tokens" "TokenStream"
    "TokenSwap" "NameMarket" "Transact" "TransactService" "Homepage" "VirtualServer"
    "WebCrypto" "Workshop" "WsAuth" "Config" "XAdmin" "XBasic" "XCommonApi" "XDb"
    "XDefault" "XHttp" "XKeys" "XPackages" "XPeers" "XProxy" "XRun" "XSites" "XTimer"
    "XTransact" "ReservedNames" "DevNameMarkets"
  ];

  psibaseSrc = stdenv.mkDerivation {
    pname = "psibase-src";
    inherit version;
    dontUnpack = true;
    dontConfigure = true;
    dontBuild = true;
    dontFixup = true;
    installPhase = ''
      mkdir -p $out
      cp -a ${src}/. $out/
      chmod -R u+w $out
      rm -rf $out/external/Catch2 $out/external/eos-vm $out/external/rapidjson
      mkdir -p $out/external
      cp -a ${catch2Src}/. $out/external/Catch2/
      cp -a ${eosVmSrc}/. $out/external/eos-vm/
      cp -a ${rapidjsonSrc}/. $out/external/rapidjson/
      mkdir -p $out/packages/user/CommonApi/common/resources/thirdParty/src
      cp ${htmSrc} $out/packages/user/CommonApi/common/resources/thirdParty/src/htm.module.js
      cp ${reactSrc} $out/packages/user/CommonApi/common/resources/thirdParty/src/react.production.min.js
      cp ${reactDomSrc} $out/packages/user/CommonApi/common/resources/thirdParty/src/react-dom.production.min.js
      test -f $out/external/Catch2/CMakeLists.txt
      test -f $out/external/eos-vm/external/softfloat.cmake
      test -f $out/external/rapidjson/include/rapidjson/document.h
    '';
  };

  boostSrc = stdenv.mkDerivation {
    pname = "boost";
    version = "1.81.0";
    src = boostTarball;
    sourceRoot = "boost_1_81_0";
    dontConfigure = true;
    dontBuild = true;
    dontFixup = true;
    installPhase = ''
      mkdir -p $out
      cp -a . $out/
    '';
  };

  cargoVendor = stdenv.mkDerivation {
    pname = "psibase-cargo-vendor";
    inherit version;
    src = src;
    nativeBuildInputs = [ rustToolchain pkgs.cacert pkgs.pkg-config pkgs.git ];
    outputHashAlgo = "sha256";
    outputHashMode = "recursive";
    outputHash = "sha256-XQ3+Oj9A0hYhcs1R5vf+V5DZD+g3oVJkfuO12+G4kgw=";
    dontConfigure = true;
    dontFixup = true;
    buildPhase = ''
      export HOME=$TMPDIR/home
      export CARGO_HOME=$TMPDIR/cargo-home
      mkdir -p "$HOME" "$CARGO_HOME"
      vendor() {
        cargo vendor --locked --versioned-dirs "$@" "$out"
      }
      ( cd rust && vendor )
      ( cd packages && vendor --no-delete )
      ( cd packages/user && vendor --no-delete )
      ( cd packages/system && vendor --no-delete )
      ( cd packages/user/CommonApi/common/packages/component-parser && vendor --no-delete )
      ( cd packages/local/XAdmin/ui/wasm && vendor --no-delete )
    '';
    dontInstall = true;
  };

  cargoHomeSetup = ''
    export CARGO_HOME=$TMPDIR/cargo-home
    mkdir -p "$CARGO_HOME"
    cat > "$CARGO_HOME/config.toml" <<EOF
    [net]
    offline = true

    [source.crates-io]
    replace-with = "vendored-sources"

    [source.vendored-sources]
    directory = "${cargoVendor}"
    EOF
    export CARGO_NET_OFFLINE=true
    export CARGO_BUILD_JOBS=${toString jobs}
    export CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=${stdenv.cc}/bin/gcc
    export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=${stdenv.cc}/bin/gcc
  '';

  yarnCache = stdenv.mkDerivation {
    pname = "psibase-yarn-cache";
    version = "4.18.0";
    src = src;
    nativeBuildInputs = [ yarnBerry nodejs24 pkgs.cacert pkgs.git ];
    outputHashAlgo = "sha256";
    outputHashMode = "recursive";
    outputHash = "sha256-/8wV4gt6EpC/AsUt7iz5kOeOgA5FM2Wu0n3v2bo8AGE=";
    dontConfigure = true;
    dontFixup = true;
    buildPhase = ''
      export HOME=$TMPDIR/home
      mkdir -p "$HOME"
      export YARN_CACHE_FOLDER=$out
      export YARN_ENABLE_GLOBAL_CACHE=false
      cd packages
      yarn install --immutable
    '';
    dontInstall = true;
  };

  wasmSysroot = stdenv.mkDerivation {
    pname = "psibase-wasm-sysroot";
    inherit version;
    dontUnpack = true;
    dontConfigure = true;
    dontStrip = true;
    dontPatchELF = true;
    nativeBuildInputs = [
      wasiSdk
      pkgs.python3
      pkgs.perl
      pkgs.cmake
      pkgs.pkg-config
    ];
    buildPhase = ''
      mkdir -p $out
      export PATH=${wasiSdk}/bin:$PATH

      tar -xf ${zlibSrc}
      (
        cd zlib-1.2.13
        export CC=${wasiSdk}/bin/clang
        export AR=${wasiSdk}/bin/llvm-ar
        export RANLIB=${wasiSdk}/bin/llvm-ranlib
        export CFLAGS="--sysroot=${wasiSdk}/share/wasi-sysroot --target=wasm32-wasip1"
        ./configure --prefix=$out --static
        make -j${toString jobs}
        make install
      )

      tar -xf ${opensslSrc}
      patchShebangs openssl-3.0.7
      (
        cd openssl-3.0.7
        flags="--sysroot=${wasiSdk}/share/wasi-sysroot --target=wasm32-wasip1 -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -DNO_SYSLOG -DOPENSSL_NO_SECURE_MEMORY -Wno-error=implicit-function-declaration"
        perl ./Configure linux-generic32 \
          --prefix=$out \
          no-afalgeng no-asm no-autoalginit no-autoerrinit no-autoload-config \
          no-dso no-async no-shared no-sock no-tests no-threads no-ui \
          CC=${wasiSdk}/bin/clang \
          CXX=${wasiSdk}/bin/clang++ \
          AR=${wasiSdk}/bin/llvm-ar \
          RANLIB=${wasiSdk}/bin/llvm-ranlib \
          CFLAGS="$flags" \
          CXXFLAGS="$flags"
        make -j${toString jobs} install_dev install_engines
      )

      tar -xf ${botanSrc}
      (
        cd Botan-3.1.1
        ${pkgs.python3}/bin/python3 ./configure.py \
          --cc-bin=${wasiSdk}/bin/clang++ \
          --cc=gcc \
          --cpu=generic \
          --os=none \
          --ar-command=${wasiSdk}/bin/llvm-ar \
          --build-targets=static \
          --with-sysroot-dir=${wasiSdk}/share/wasi-sysroot \
          --minimized-build \
          --enable-modules=ecdsa,bcrypt,raw_hash,auto_rng,sha2_64,getentropy \
          --with-os-feature=getentropy \
          --cxxflags="--target=wasm32-wasip1 -O3 -msign-ext -mnontrapping-fptoint -mbulk-memory" \
          --without-stack-protector \
          --prefix=$out
        make -j${toString jobs}
        make install
      )

      tar -C $out -xf ${sqliteSrc}

      unset CC CXX AR RANLIB CFLAGS CXXFLAGS
      cmake -S ${catch2Src} -B catch2-build \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=$out \
        -DBUILD_TESTING=OFF \
        -DCATCH_INSTALL_DOCS=OFF \
        -DCATCH_INSTALL_EXTRAS=OFF \
        -DCATCH_CONFIG_NO_POSIX_SIGNALS=ON \
        -DCMAKE_TOOLCHAIN_FILE=${src}/wasm/toolchain.cmake \
        -DWASI_SDK_PREFIX=${wasiSdk} \
        -DCMAKE_SYSROOT=${wasiSdk}/share/wasi-sysroot \
        -DCMAKE_C_COMPILER=${wasiSdk}/bin/clang \
        -DCMAKE_CXX_COMPILER=${wasiSdk}/bin/clang++ \
        -DCMAKE_AR=${wasiSdk}/bin/llvm-ar \
        -DCMAKE_RANLIB=${wasiSdk}/bin/llvm-ranlib
      cmake --build catch2-build -j${toString jobs}
      cmake --install catch2-build
    '';
    installPhase = "true";
  };

  native = stdenv.mkDerivation {
    pname = "psibase-native";
    inherit version;
    src = psibaseSrc;
    nativeBuildInputs = [ pkgs.cmake pkgs.pkg-config pkgs.python3 ];
    buildInputs = [ boostForCMake pkgs.openssl pkgs.zlib pkgs.icu ];
    dontConfigure = true;
    dontStrip = false;
    buildPhase = ''
      cmake -S . -B build \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=$out \
        -DPSIBASE_BUILD_NATIVE_ONLY=ON \
        -DPSIBASE_STATIC_LIBCXX=OFF \
        -DBUILD_TESTING=OFF \
        -DCATCH_INSTALL_DOCS=OFF \
        -DCATCH_INSTALL_EXTRAS=OFF \
        -DCMAKE_PREFIX_PATH=${boostForCMake} \
        -DICU_LIBRARY_DIR=${pkgs.icu}/lib \
        -DCMAKE_SKIP_BUILD_RPATH=ON \
        -DFORCE_COLORED_OUTPUT=OFF
      cmake --build build --target psinode --target psitest -j${toString jobs}
    '';
    installPhase = ''
      cmake --install build --prefix $out --component ServerBin
      cmake --install build --prefix $out --component ServerData
      cmake --install build --prefix $out --component Tester
    '';
  };

  rustHost = stdenv.mkDerivation {
    pname = "psibase-rust-host";
    inherit version;
    src = psibaseSrc;
    nativeBuildInputs = [
      rustToolchain
      pkgs.cmake
      pkgs.pkg-config
      pkgs.python3
      llvmPackages.clang
      llvmPackages.libclang
    ];
    buildInputs = [ pkgs.openssl pkgs.zlib ];
    LIBCLANG_PATH = "${llvmPackages.libclang.lib}/lib";
    buildPhase = ''
      ${cargoHomeSetup}
      cd rust
      cargo build -r --locked --offline -j${toString jobs} \
        -p psibase -p cargo-psibase -p reserved-names -p md2man -p gen-cpp-doc
      mkdir -p $out/bin
      cp target/release/psibase \
         target/release/cargo-psibase \
         target/release/reserved-names \
         target/release/md2man \
         target/release/gen-cpp-doc \
         $out/bin/
    '';
    dontConfigure = true;
    dontInstall = true;
  };

  plugins = stdenv.mkDerivation {
    pname = "psibase-plugins";
    inherit version;
    src = psibaseSrc;
    nativeBuildInputs = [ rustToolchain cargoComponent pkgs.binaryen ];
    dontConfigure = true;
    dontStrip = true;
    dontPatchELF = true;
    buildPhase = ''
      ${cargoHomeSetup}
      cd packages
      cargo component build -r --locked --offline --target wasm32-wasip1 -j${toString jobs}
      mkdir -p $out
      find target/wasm32-wasip1/release -maxdepth 1 -name '*.wasm' -exec cp {} $out/ \;
      test -n "$(ls -A $out)"
    '';
    dontInstall = true;
  };

  componentParser = stdenv.mkDerivation {
    pname = "psibase-component-parser";
    inherit version;
    src = psibaseSrc;
    nativeBuildInputs = [ rustToolchain cargoComponent ];
    dontConfigure = true;
    dontStrip = true;
    dontPatchELF = true;
    buildPhase = ''
      ${cargoHomeSetup}
      cd packages/user/CommonApi/common/packages/component-parser
      cargo component build -r --locked --offline --target wasm32-unknown-unknown -j${toString jobs}
      mkdir -p $out
      cp target/wasm32-unknown-unknown/release/component_parser.wasm $out/
    '';
    dontInstall = true;
  };

  cppWasm = stdenv.mkDerivation {
    pname = "psibase-cpp-wasm";
    inherit version;
    src = psibaseSrc;
    nativeBuildInputs = [ pkgs.cmake pkgs.python3 pkgs.binaryen wasiSdk ];
    dontConfigure = true;
    dontStrip = true;
    dontPatchELF = true;
    buildPhase = ''
      export PATH=${pkgs.binaryen}/bin:${wasiSdk}/bin:$PATH
      unset CC CXX
      mkdir -p work/wasm
      ln -sfn ${wasmSysroot} work/wasm/deps
      cmake -S wasm -B work/wasm \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_RELEASE_WASM=ON \
        -DBUILD_DEBUG_WASM=OFF \
        -DBUILD_TESTING=OFF \
        -DFORCE_COLORED_OUTPUT=OFF \
        -DCMAKE_TOOLCHAIN_FILE=$PWD/wasm/toolchain.cmake \
        -DWASI_SDK_PREFIX=${wasiSdk} \
        -DCMAKE_SYSROOT=${wasiSdk}/share/wasi-sysroot \
        -DPSIBASE_DEP_PREFIX=${wasmSysroot} \
        -DPSIBASE_BOOST_ROOT=${boostSrc} \
        -DPSITEST_EXECUTABLE=${native}/bin/psitest \
        -DCMAKE_FIND_ROOT_PATH=${wasmSysroot} \
        -DCMAKE_PREFIX_PATH=${wasmSysroot} \
        -DCMAKE_INSTALL_PREFIX=$out
      cmake --build work/wasm -j${toString jobs}
      mkdir -p $out/wasm
      cp work/*.wasm work/*-schema.json $out/wasm/
    '';
    dontInstall = true;
  };

  ui = stdenv.mkDerivation {
    pname = "psibase-ui";
    inherit version;
    src = psibaseSrc;
    nativeBuildInputs = [ yarnBerry nodejs24 rustToolchain cargoComponent pkgs.pkg-config ];
    buildInputs = [ pkgs.openssl pkgs.zlib ];
    dontConfigure = true;
    dontStrip = true;
    dontPatchELF = true;
    buildPhase = ''
      ${cargoHomeSetup}
      export HOME=$TMPDIR/home
      mkdir -p "$HOME"
      mkdir -p $TMPDIR/yarn-cache
      cp -a ${yarnCache}/. $TMPDIR/yarn-cache/
      chmod -R u+w $TMPDIR/yarn-cache
      export YARN_CACHE_FOLDER=$TMPDIR/yarn-cache
      export YARN_ENABLE_GLOBAL_CACHE=false
      export YARN_ENABLE_OFFLINE_MODE=1
      export YARN_ENABLE_TELEMETRY=0
      export PSIREBUILD=true
      cd packages
      yarn install --immutable
      cd ..
      ${lib.concatMapStringsSep "\n" (rel: ''
        echo "yarn build ${rel}"
        ( cd ${rel} && yarn build )
        mkdir -p $out/${rel}
        cp -a ${rel}/dist $out/${rel}/dist
      '') uiProjects}
    '';
    dontInstall = true;
  };

  copyUi = ''
    ${lib.concatMapStringsSep "\n" (rel: ''
      mkdir -p ${rel}
      rm -rf ${rel}/dist
      cp -a ${ui}/${rel}/dist ${rel}/dist
    '') uiProjects}
  '';

  packageWorkspace = name: manifest: withUi: stdenv.mkDerivation {
    pname = name;
    inherit version;
    src = psibaseSrc;
    nativeBuildInputs = [ rustToolchain cargoComponent ];
    dontConfigure = true;
    dontStrip = true;
    dontPatchELF = true;
    buildPhase = ''
      ${cargoHomeSetup}
      export CARGO_PSIBASE_PSITEST=${native}/bin/psitest
      export CARGO_PSIBASE_PSIBASE=${rustHost}/bin/psibase
      export PATH=${rustHost}/bin:${cargoComponent}/bin:$PATH
      ${lib.optionalString withUi copyUi}
      mkdir -p $out $TMPDIR/cargo-target
      cargo psibase package \
        --manifest-path ${manifest} \
        --target-dir $TMPDIR/cargo-target \
        -j${toString jobs}
      cp $TMPDIR/cargo-target/wasm32-wasip1/release/packages/*.psi $out/
    '';
    dontInstall = true;
  };

  userServices = packageWorkspace "psibase-user-services" "packages/user/Cargo.toml" true;
  systemServices = packageWorkspace "psibase-system-services" "packages/system/Cargo.toml" false;

  book = stdenv.mkDerivation {
    pname = "psibase-book";
    inherit version;
    src = psibaseSrc;
    nativeBuildInputs = [
      mdbook mdbookMermaid mdbookPagetoc mdbookPlugins mdbookLinkcheck pkgs.python3
    ];
    dontConfigure = true;
    dontStrip = true;
    buildPhase = ''
      export LIBCLANG_PATH=${llvmPackages.libclang.lib}/lib
      export LD_LIBRARY_PATH=${llvmPackages.libclang.lib}/lib
      export WASI_SDK_PREFIX=${wasiSdk}
      builddir=$TMPDIR/fake-build
      docdir=$TMPDIR/doc
      mkdir -p $builddir/wasm/deps $docdir
      ln -sfn ${boostSrc} $builddir/wasm/boost
      ln -sfn ${wasmSysroot}/include $builddir/wasm/deps/include
      cp -a doc/theme $docdir/theme
      sed \
        -e 's|''${CMAKE_CURRENT_BINARY_DIR}/rust/release/gen-cpp-doc|${rustHost}/bin/gen-cpp-doc|g' \
        -e 's|''${CMAKE_CURRENT_SOURCE_DIR}|'"$PWD"'|g' \
        -e 's|''${CMAKE_CURRENT_BINARY_DIR}|'"$builddir"'|g' \
        -e 's|''${WASI_SDK_PREFIX}|${wasiSdk}|g' \
        -e 's|/usr/bin/env WASI_SDK_PREFIX=[^ ]* ||' \
        doc/book.toml.in > $docdir/book.toml
      mdbook build -d $out $docdir
    '';
    dontInstall = true;
  };

  pack = stdenv.mkDerivation {
    pname = "psibase-packages";
    inherit version;
    src = psibaseSrc;
    nativeBuildInputs = [ pkgs.cmake ];
    dontConfigure = true;
    dontStrip = true;
    buildPhase = ''
      ${copyUi}
      mkdir -p build/rust/release build/book nix-plugins nix-cargo
      cp ${cppWasm}/wasm/*.wasm ${cppWasm}/wasm/*-schema.json build/
      cp -a ${book}/html build/book/html
      cp ${rustHost}/bin/reserved-names build/rust/release/reserved-names
      cp ${plugins}/*.wasm ${componentParser}/*.wasm nix-plugins/
      cp ${userServices}/*.psi ${systemServices}/*.psi nix-cargo/
      cmake -S . -B build \
        -DCMAKE_BUILD_TYPE=Release \
        -DPSIBASE_NIX_PACKAGE_ONLY=ON \
        -DBUILD_EXAMPLES=OFF \
        -DFORCE_COLORED_OUTPUT=OFF \
        -DPSIBASE_PLUGIN_DIR=$PWD/nix-plugins \
        -DPSIBASE_CARGO_PACKAGES=$PWD/nix-cargo
      cmake --build build --target package-index --target DevNameMarkets -j${toString jobs}
      mkdir -p $out/share/psibase/packages
      cp -a build/share/psibase/packages/. $out/share/psibase/packages/
      test -f $out/share/psibase/packages/index.json
      test -f $out/share/psibase/packages/ProdDefault.psi
      test -f $out/share/psibase/packages/Minimal.psi
    '';
    dontInstall = true;
  };

  psiPackage = name: pkgs.runCommand "${name}.psi" { } ''
    mkdir -p $out
    cp ${pack}/share/psibase/packages/${name}.psi $out/
  '';

  psibase = pkgs.symlinkJoin {
    name = "psibase-${version}";
    paths = [ native rustHost pack ];
    meta = {
      description = "psinode, the psibase CLI, and the packaged chain";
      mainProgram = "psinode";
      platforms = [ "x86_64-linux" "aarch64-linux" ];
    };
  };
in
{
  inherit psibaseSrc boostSrc cargoVendor yarnCache wasmSysroot native rustHost
    plugins componentParser cppWasm ui userServices systemServices book pack psibase;
  packages = {
    default = psibase;
    psibase = psibase;
    wasm-sysroot = wasmSysroot;
    native = native;
    rust-host = rustHost;
    plugins = plugins;
    component-parser = componentParser;
    cpp-wasm = cppWasm;
    ui = ui;
    user-services = userServices;
    system-services = systemServices;
    book = book;
    pack = pack;
    cargo-vendor = cargoVendor;
    yarn-cache = yarnCache;
  } // lib.listToAttrs (map (name: {
    name = "pkg-${name}";
    value = psiPackage name;
  }) psiNames);
}
