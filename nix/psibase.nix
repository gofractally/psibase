# From-source runtime package.
# Layout contract (psibase-nix): $out/{bin,share/psibase}
{
  lib,
  stdenv,
  stdenvNoCC,
  callPackage,
  fetchurl,
  fetchFromGitHub,
  cmake,
  ninja,
  gnumake,
  pkg-config,
  python3,
  perl,
  git,
  jq,
  xxd,
  unzip,
  zip,
  zstd,
  cacert,
  binaryen,
  wabt,
  openssl,
  zlib,
  icu,
  boostForCMake,
  llvmPackages,
  rustToolchain,
  wasiSdk,
  yarnBerry,
  cargoComponent,
  wasmPack,
  wasmTools,
  nodejs20,
  mdbook,
  mdbookMermaid,
  mdbookPagetoc,
  mdbookPlugins,
  mdbookLinkcheck,
  removeReferencesTo,
  src,
  version ? "0.27.0",
}:

let
  inherit (lib) fileset;

  # CMake file(DOWNLOAD) / ExternalProject tarballs (hashes from CMakeLists.txt).
  botanTarball = fetchurl {
    url = "https://github.com/gofractally/psibase/releases/download/deps/Botan-3.1.1.tar.xz";
    hash = "sha256-MMhP6RmTapj+9TMfJGxiqiwOTSCFstRREgf2ogr6Oms=";
  };
  zlibTarball = fetchurl {
    url = "https://github.com/gofractally/psibase/releases/download/deps/zlib-1.2.13.tar.gz";
    hash = "sha256-s6JN6XqP28g1uYMxaVAQMLiXcDG8tUs7OsE3QPhGqzA=";
  };
  gmpTarball = fetchurl {
    url = "https://github.com/gofractally/psibase/releases/download/deps/gmp-6.2.1.tar.zst";
    hash = "sha256-igw1lsCYVUUOtn9ugcX7ahC6v8SoA9ASqHe1TEMOpms=";
  };
  opensslTarball = fetchurl {
    url = "https://github.com/gofractally/psibase/releases/download/deps/openssl-3.0.7.tar.gz";
    hash = "sha256-gwSdBComDmlvYkBqxcCL9wb9hDg/lFzyG9YentlcOW4=";
  };
  boostTarball = fetchurl {
    url = "https://github.com/gofractally/psibase/releases/download/deps/boost_1_81_0.tar.bz2";
    hash = "sha256-cf7u2QD7zMoEo7Ty+Ep8IXGG8oqUDti37UclmGuvmfo=";
  };
  sqliteTarball = fetchurl {
    url = "https://github.com/gofractally/psibase/releases/download/deps/sqlite-autoconf-3450200.tar.gz";
    hash = "sha256-vJBnRC7t8905mJtcXPv/83rmbMnJknTgwwUtxNSo9q4=";
  };
  htmJs = fetchurl {
    name = "htm.module.js";
    url = "https://unpkg.com/htm@3.1.0/dist/htm.module.js";
    hash = "sha256-qzPdPzgFm5vk1fU1ASju+yNWY5xOC76dnos7p1hH6eQ=";
  };
  reactJs = fetchurl {
    name = "react.production.min.js";
    url = "https://unpkg.com/react@18/umd/react.production.min.js";
    hash = "sha256-2Unxw2h67a3O2shSYYZfKbF80nOZfn9rK/xTsvnUxN0=";
  };
  reactDomJs = fetchurl {
    name = "react-dom.production.min.js";
    url = "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js";
    hash = "sha256-NfT5dPSyvNRNpzljNH+JUuNB+DkJ5EmCJ9Tia5j2bw0=";
  };

  wasmDepTarballs = stdenvNoCC.mkDerivation {
    name = "psibase-wasm-dep-tarballs";
    dontUnpack = true;
    dontFixup = true;
    installPhase = ''
      mkdir -p $out
      cp ${zlibTarball} $out/zlib-1.2.13.tar.gz
      cp ${gmpTarball} $out/gmp-6.2.1.tar.zst
      cp ${opensslTarball} $out/openssl-3.0.7.tar.gz
      cp ${boostTarball} $out/boost_1_81_0.tar.bz2
      cp ${botanTarball} $out/Botan-3.1.1.tar.xz
      cp ${sqliteTarball} $out/sqlite-autoconf-3450200.tar.gz
    '';
  };

  wasmDeps = callPackage ./wasm-deps.nix {
    inherit
      wasiSdk
      zlibTarball
      gmpTarball
      opensslTarball
      botanTarball
      sqliteTarball
      boostTarball
      ;
  };

  # Git submodules are not part of flake `self`. Pin the same revs as .gitmodules.
  catch2Src = fetchFromGitHub {
    owner = "catchorg";
    repo = "Catch2";
    rev = "2b60af89e23d28eefc081bc930831ee9d45ea58b";
    hash = "sha256-blhSdtNXwe4wKPVKlopsE0omgikMdl12JjwqASwJM2w=";
  };
  rapidjsonSrc = fetchFromGitHub {
    owner = "Tencent";
    repo = "rapidjson";
    rev = "663f076c7b44ce96526d1acfda3fa46971c8af31";
    hash = "sha256-C6tR/W2IJoSVqygP3/L2o+z8DR+jnnGU8mlN+eAiZ2A=";
  };
  eosVmSrc = fetchFromGitHub {
    owner = "gofractally";
    repo = "eos-vm";
    rev = "f819a1d6e034561409e86e7051a91cb3eeea42f8";
    fetchSubmodules = true;
    hash = "sha256-fzHVm5yg8t34IaSSDgsXsfJTiU/RFjDQFtDyT/SoEIs=";
  };

  repoRoot = ../.;

  yarnSrc = fileset.toSource {
    root = repoRoot + "/packages";
    fileset = fileset.unions [
      (repoRoot + "/packages/yarn.lock")
      (repoRoot + "/packages/package.json")
      (repoRoot + "/packages/.yarnrc.yml")
      (fileset.fileFilter (file: file.name == "package.json") (repoRoot + "/packages"))
    ];
  };

  cargoVendorSrc = fileset.toSource {
    root = repoRoot;
    fileset = fileset.fileFilter (
      file:
      file.name == "Cargo.toml"
      || file.name == "Cargo.lock"
      || file.name == "Cargo.toml.in"
    ) repoRoot;
  };

  yarnOfflineCache = stdenvNoCC.mkDerivation {
    name = "psibase-yarn-offline-cache";
    src = yarnSrc;
    nativeBuildInputs = [
      yarnBerry
      nodejs20
      cacert
    ];
    impureEnvVars = lib.fetchers.proxyImpureEnvVars;
    outputHashAlgo = "sha256";
    outputHashMode = "nar";
    outputHash = "sha256-nF54yMP26GM+Ub4Ah4kOhXnFvJ1hzgtxenxlEtuRS7o=";

    SSL_CERT_FILE = "${cacert}/etc/ssl/certs/ca-bundle.crt";
    YARN_ENABLE_TELEMETRY = "0";

    buildPhase = ''
      runHook preBuild
      export HOME=$NIX_BUILD_TOP/home
      mkdir -p "$HOME"
      # yarnrc cacheFolder is ../.caches/yarn relative to packages/
      yarn install --immutable --mode=skip-build
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p $out
      cp -a "$NIX_BUILD_TOP/.caches/yarn/." $out/
      runHook postInstall
    '';

    dontFixup = true;
  };

  cargoVendor = stdenvNoCC.mkDerivation {
    name = "psibase-cargo-vendor";
    src = cargoVendorSrc;
    nativeBuildInputs = [
      rustToolchain
      cacert
      git
      python3
    ];
    impureEnvVars = lib.fetchers.proxyImpureEnvVars;
    outputHashAlgo = "sha256";
    outputHashMode = "nar";
    outputHash = "sha256-18D11TtmbNq/e4V8inz9e2AX8FG6ejPKrscu5Ue6lsI=";

    SSL_CERT_FILE = "${cacert}/etc/ssl/certs/ca-bundle.crt";

    buildPhase = ''
      runHook preBuild
      export HOME=$NIX_BUILD_TOP/home
      export CARGO_HOME=$NIX_BUILD_TOP/cargo-home
      mkdir -p "$HOME" "$CARGO_HOME" $out

      # Manifests-only fileset: cargo needs a target file to load each crate.
      cp rust/cargo-psibase/service_wasi_polyfill/Cargo.toml.in \
         rust/cargo-psibase/service_wasi_polyfill/Cargo.toml
      python3 - <<'PY'
      from pathlib import Path
      import re
      for toml in Path(".").rglob("Cargo.toml"):
          text = toml.read_text()
          root = toml.parent
          for m in re.finditer(r'(?m)^\s*path\s*=\s*"([^"]+\.rs)"', text):
              p = root / m.group(1)
              p.parent.mkdir(parents=True, exist_ok=True)
              if not p.exists():
                  p.write_text("")
          src = root / "src"
          has_src = src.is_dir() and any(src.glob("*.rs"))
          has_explicit_rs = bool(re.search(r'(?m)^\s*path\s*=\s*"[^"]+\.rs"', text))
          if not has_src and not has_explicit_rs:
              src.mkdir(exist_ok=True)
              (src / "lib.rs").write_text("")
      PY

      vendor_ws() {
        local manifest="$1"
        echo "cargo vendor $manifest"
        local tmp=$NIX_BUILD_TOP/vendor-tmp
        rm -rf "$tmp"
        mkdir -p "$tmp"
        cargo vendor --locked --versioned-dirs --manifest-path "$manifest" "$tmp"
        chmod -R u+w $out "$tmp"
        cp -a "$tmp"/. $out/
      }

      vendor_ws rust/Cargo.toml
      vendor_ws packages/Cargo.toml
      vendor_ws packages/system/Cargo.toml
      vendor_ws packages/user/Cargo.toml
      vendor_ws packages/local/XAdmin/ui/wasm/Cargo.toml
      vendor_ws packages/user/CommonApi/common/packages/component-parser/Cargo.toml
      vendor_ws rust/cargo-psibase/service_wasi_polyfill/Cargo.toml
      runHook postBuild
    '';

    installPhase = "true";
    dontFixup = true;
  };

  psibaseCli = callPackage ./psibase-cli.nix {
    inherit rustToolchain cargoVendor version llvmPackages;
  };

  psibasePlugins = callPackage ./psibase-plugins.nix {
    inherit
      rustToolchain
      cargoVendor
      cargoComponent
      wasmTools
      version
      ;
  };

  yarnUis = callPackage ./yarn-uis.nix {
    inherit
      yarnBerry
      nodejs20
      yarnOfflineCache
      version
      ;
  };

  # relPath under packages/ → prebuilt dist derivation. XAdmin is omitted.
  prebuiltUiDist = {
    "user/CommonApi/common/packages/common-lib" = yarnUis.common-lib;
    "system/Accounts/ui" = yarnUis.accounts;
    "user/Evaluations/ui" = yarnUis.evaluations;
    "user/Fractals/ui" = yarnUis.fractals;
    "user/FractalCore/ui" = yarnUis.fractal-core;
    "user/TokenStream/ui" = yarnUis.token-stream;
    "user/CommonApi/common/packages/plugin-tester/ui" = yarnUis.plugin-tester;
    "user/Explorer/ui" = yarnUis.explorer;
    "user/Homepage/ui" = yarnUis.homepage;
    "user/Identity/ui" = yarnUis.identity;
    "user/Permissions/ui" = yarnUis.permissions;
    "user/Supervisor/ui" = yarnUis.supervisor;
    "user/Workshop/ui" = yarnUis.workshop;
    "user/Config/ui" = yarnUis.config;
    "local/XProxy/ui" = yarnUis.xproxy;
  };

  srcFiltered = lib.cleanSourceWith {
    name = "psibase-src";
    inherit src;
    filter =
      path: type:
      let
        rel = lib.removePrefix (toString src + "/") (toString path);
      in
      rel != "flake.nix"
      && rel != "flake.lock"
      && !(lib.hasPrefix "nix/" rel);
  };

  # C++ native + WASI services. Fileset drops Yarn UIs and cargo-component
  # plugins so those changes do not rebuild psinode / service wasm.
  collectPkgSubdir =
    cat: sub:
    let
      dir = repoRoot + "/packages/${cat}";
      ents = builtins.readDir dir;
    in
    lib.concatMap (
      name:
      let
        p = dir + "/${name}/${sub}";
      in
      lib.optional (ents.${name} == "directory" && builtins.pathExists p) p
    ) (builtins.attrNames ents);

  compileSkip = fileset.unions (
    collectPkgSubdir "system" "plugin"
    ++ collectPkgSubdir "user" "plugin"
    ++ collectPkgSubdir "local" "plugin"
    ++ collectPkgSubdir "system" "ui"
    ++ collectPkgSubdir "user" "ui"
    ++ collectPkgSubdir "local" "ui"
    ++ [
      (repoRoot + "/packages/shared-ui")
      (repoRoot + "/packages/user/CommonApi/common/packages/common-lib")
      (repoRoot + "/packages/user/CommonApi/common/packages/plugin-tester")
      (repoRoot + "/packages/user/CommonApi/common/packages/component-parser")
      (fileset.maybeMissing (repoRoot + "/packages/target"))
      (fileset.maybeMissing (repoRoot + "/packages/user/target"))
      (fileset.maybeMissing (repoRoot + "/packages/system/target"))
    ]
  );

  compileSrc = fileset.toSource {
    root = repoRoot;
    fileset = fileset.difference (fileset.unions [
      (repoRoot + "/CMakeLists.txt")
      (repoRoot + "/web-apps.cmake")
      (repoRoot + "/LICENSE")
      (repoRoot + "/make_package_index.sh")
      (repoRoot + "/doc/book.toml.in")
      (repoRoot + "/libraries")
      (repoRoot + "/native")
      (repoRoot + "/programs")
      (repoRoot + "/wasm")
      (repoRoot + "/external/CMakeLists.txt")
      (repoRoot + "/rust/CMakeLists.txt")
      (repoRoot + "/packages")
    ]) compileSkip;
  };

  wasmServices = stdenv.mkDerivation {
    pname = "psibase-wasm-services";
    inherit version;

    src = compileSrc;

    nativeBuildInputs = [
      cmake
      ninja
      gnumake
      pkg-config
      python3
      perl
      git
      jq
      xxd
      unzip
      zip
      zstd
      binaryen
      wabt
    ];

    buildInputs = [
      boostForCMake
      openssl
      zlib
      zstd
      icu
    ];

    dontUseCmakeConfigure = true;
    dontStrip = true;

    WASI_SDK_PREFIX = wasiSdk;
    ICU_ROOT = icu;

    disallowedReferences = [ wasiSdk ];

    postUnpack = ''
      mkdir -p "$sourceRoot/external"
      rm -rf "$sourceRoot/external/Catch2" "$sourceRoot/external/eos-vm" "$sourceRoot/external/rapidjson"
      mkdir -p "$sourceRoot/external/Catch2" "$sourceRoot/external/eos-vm" "$sourceRoot/external/rapidjson"
      cp -a ${catch2Src}/. "$sourceRoot/external/Catch2/"
      cp -a ${eosVmSrc}/. "$sourceRoot/external/eos-vm/"
      cp -a ${rapidjsonSrc}/. "$sourceRoot/external/rapidjson/"
      chmod -R u+w "$sourceRoot/external"
    '';

    postPatch = ''
      python3 ${./offline-wasm-deps.py}

      substituteInPlace wasm/CMakeLists.txt \
        --replace-fail \
          "set(DEP_URL https://github.com/gofractally/psibase/releases/download/deps)" \
          "set(DEP_URL ${wasmDepTarballs})"

      substituteInPlace wasm/boost/CMakeLists.txt \
        --replace-fail \
          "https://github.com/gofractally/psibase/releases/download/deps/boost_1_81_0.tar.bz2" \
          "${wasmDepTarballs}/boost_1_81_0.tar.bz2"

      substituteInPlace CMakeLists.txt \
        --replace-fail \
          "URL https://github.com/gofractally/psibase/releases/download/deps/Botan-3.1.1.tar.xz" \
          "URL ${botanTarball}"

      substituteInPlace CMakeLists.txt \
        --replace-fail \
          "CONFIGURE_COMMAND <SOURCE_DIR>/configure.py" \
          "CONFIGURE_COMMAND python3 <SOURCE_DIR>/configure.py"

      substituteInPlace wasm/CMakeLists.txt \
        --replace-fail \
          "./Configure linux-generic32" \
          "perl Configure linux-generic32"

      substituteInPlace wasm/CMakeLists.txt \
        --replace-fail \
          "set(WASM_FEATURES -msign-ext -mnontrapping-fptoint -msimd128 -mbulk-memory)" \
          "set(WASM_FEATURES -msign-ext -mnontrapping-fptoint -msimd128 -mbulk-memory -mno-reference-types)"

      substituteInPlace CMakeLists.txt \
        --replace-fail \
          "-DBUILD_RELEASE_WASM=ON" \
          "-DBUILD_RELEASE_WASM=ON -DCMAKE_CXX_SCAN_FOR_MODULES=OFF -DCMAKE_C_FLAGS= -DCMAKE_CXX_FLAGS="
    '';

    configurePhase = ''
      runHook preConfigure
      export HOME=$NIX_BUILD_TOP/home
      export TMPDIR=$NIX_BUILD_TOP/tmp
      mkdir -p "$HOME" "$TMPDIR"

      unset NIX_LDFLAGS NIX_LDFLAGS_BEFORE NIX_CFLAGS_LINK LD_LIBRARY_PATH
      unset NIX_CFLAGS_COMPILE NIX_CFLAGS_COMPILE_BEFORE CFLAGS CXXFLAGS LDFLAGS
      export NIX_LDFLAGS="-L${icu}/lib -L${openssl.out}/lib -L${zlib}/lib -L${zstd}/lib"
      export CMAKE_PREFIX_PATH="${boostForCMake}:${lib.getDev openssl}:${lib.getLib openssl}:${lib.getDev icu}:${icu}"
      export CMAKE_IGNORE_PATH="/usr/lib:/usr/lib64"
      export CMAKE_SYSTEM_IGNORE_PATH="/usr/lib:/usr/lib64"
      export ICU_LIBRARY_DIR="${icu}/lib"
      export BOOST_LIBRARYDIR="${boostForCMake}/lib"
      export BOOST_INCLUDEDIR="${boostForCMake}/include"

      mkdir -p build/wasm/deps build/wasm/boost
      cp -a ${wasmDeps}/. build/wasm/deps/
      chmod -R u+w build/wasm/deps
      rm -rf build/wasm/deps/boost
      cp -a ${wasmDeps}/boost/. build/wasm/boost/
      chmod -R u+w build/wasm/boost
      cd build
      cmake -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=$NIX_BUILD_TOP/psidk \
        -DBUILD_DEBUG_WASM=OFF \
        -DBUILD_EXAMPLES=OFF \
        -DBUILD_TESTING=OFF \
        -DBUILD_DOC=OFF \
        -DENABLE_SSL=ON \
        -DWASI_SDK_PREFIX=${wasiSdk} \
        -DICU_LIBRARY_DIR=${icu}/lib \
        -DCMAKE_PREFIX_PATH="$CMAKE_PREFIX_PATH" \
        -DCMAKE_IGNORE_PATH=/usr/lib:/usr/lib64 \
        -DCMAKE_SYSTEM_IGNORE_PATH=/usr/lib:/usr/lib64 \
        -DFORCE_COLORED_OUTPUT=OFF \
        -DPSIBASE_PREBUILT_WASM_DEPS=ON \
        -DPSIBASE_COMPILE_ONLY=ON \
        ..
      runHook postConfigure
    '';

    buildPhase = ''
      runHook preBuild
      cd "$NIX_BUILD_TOP/$sourceRoot/build"
      ninja -j$NIX_BUILD_CORES wasm psinode
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      cd "$NIX_BUILD_TOP/$sourceRoot/build"
      install -Dm755 psinode "$out/bin/psinode"
      install -Dm755 psitest "$out/bin/psitest"
      mkdir -p "$out/service-wasm"
      shopt -s nullglob
      cp -a *.wasm *-schema.json "$out/service-wasm/"
      if [ -f share/psibase/config.in ]; then
        install -Dm644 share/psibase/config.in "$out/share/psibase/config.in"
      fi
      if [ -d share/psibase/wasm ]; then
        mkdir -p "$out/share/psibase/wasm"
        cp -a share/psibase/wasm/. "$out/share/psibase/wasm/"
      fi
      bash ${./fix-psi-wasm.sh} "$out"
      runHook postInstall
    '';

    doInstallCheck = true;
    installCheckPhase = ''
      runHook preInstallCheck
      psinodeVersion=$($out/bin/psinode --version 2>&1 || true)
      echo "psinode --version: $psinodeVersion"
      case "$psinodeVersion" in
        "psinode "*) ;;
        *)
          echo "unexpected psinode --version output" >&2
          exit 1
          ;;
      esac
      for f in Transact.wasm Accounts.wasm Transact-schema.json Accounts-schema.json; do
        if [ ! -s "$out/service-wasm/$f" ]; then
          echo "missing compiled service: $f" >&2
          exit 1
        fi
      done
      runHook postInstallCheck
    '';

    meta = {
      description = "psibase C++ native node and WASI service wasm";
      license = lib.licenses.mit;
      platforms = [
        "x86_64-linux"
        "aarch64-linux"
      ];
    };
  };

  rsPackages = callPackage ./psibase-rs-packages.nix {
    inherit
      rustToolchain
      cargoVendor
      cargoComponent
      wasmTools
      version
      llvmPackages
      yarnUis
      wasmServices
      ;
  };
in
stdenv.mkDerivation {
  pname = "psibase";
  inherit version;

  src = srcFiltered;

  nativeBuildInputs = [
    cmake
    ninja
    gnumake
    pkg-config
    python3
    perl
    git
    jq
    xxd
    unzip
    zstd
    cacert
    binaryen
    wabt
    rustToolchain
    cargoComponent
    wasmPack
    wasmTools
    nodejs20
    yarnBerry
    mdbook
    mdbookMermaid
    mdbookPagetoc
    mdbookPlugins
    mdbookLinkcheck
    removeReferencesTo
  ];

  buildInputs = [
    boostForCMake
    openssl
    zlib
    zstd
    icu
  ];

  # rustc embeds stdlib paths (`file!()` in panics) into bin/psibase. Remap so
  # those strings are not store paths; remove-references-to is the backstop.
  RUSTFLAGS = "--remap-path-prefix ${rustToolchain}=/rustc";
  disallowedReferences = [
    rustToolchain
    wasiSdk
  ];

  dontUseCmakeConfigure = true;

  WASI_SDK_PREFIX = wasiSdk;
  LIBCLANG_PATH = "${llvmPackages.libclang.lib}/lib";
  ICU_ROOT = icu;
  OPENSSL_NO_VENDOR = "1";
  CARGO_TERM_COLOR = "always";
  CARGO_NET_OFFLINE = "true";
  YARN_ENABLE_TELEMETRY = "0";
  YARN_ENABLE_NETWORK = "0";
  YARN_ENABLE_OFFLINE_MODE = "true";
  COREPACK_ENABLE_NETWORK = "0";

  postUnpack = ''
    mkdir -p "$sourceRoot/external"
    rm -rf "$sourceRoot/external/Catch2" "$sourceRoot/external/eos-vm" "$sourceRoot/external/rapidjson"
    mkdir -p "$sourceRoot/external/Catch2" "$sourceRoot/external/eos-vm" "$sourceRoot/external/rapidjson"
    cp -a ${catch2Src}/. "$sourceRoot/external/Catch2/"
    cp -a ${eosVmSrc}/. "$sourceRoot/external/eos-vm/"
    cp -a ${rapidjsonSrc}/. "$sourceRoot/external/rapidjson/"
    chmod -R u+w "$sourceRoot/external"
  '';

  postPatch = ''
    python3 ${./offline-wasm-deps.py}

    substituteInPlace wasm/CMakeLists.txt \
      --replace-fail \
        "set(DEP_URL https://github.com/gofractally/psibase/releases/download/deps)" \
        "set(DEP_URL ${wasmDepTarballs})"

    substituteInPlace wasm/boost/CMakeLists.txt \
      --replace-fail \
        "https://github.com/gofractally/psibase/releases/download/deps/boost_1_81_0.tar.bz2" \
        "${wasmDepTarballs}/boost_1_81_0.tar.bz2"

    substituteInPlace CMakeLists.txt \
      --replace-fail \
        "URL https://github.com/gofractally/psibase/releases/download/deps/Botan-3.1.1.tar.xz" \
        "URL ${botanTarball}"

    # Sandbox has no /usr/bin/env for Botan configure.py's shebang.
    substituteInPlace CMakeLists.txt \
      --replace-fail \
        "CONFIGURE_COMMAND <SOURCE_DIR>/configure.py" \
        "CONFIGURE_COMMAND python3 <SOURCE_DIR>/configure.py"

    substituteInPlace wasm/CMakeLists.txt \
      --replace-fail \
        "./Configure linux-generic32" \
        "perl Configure linux-generic32"

    # LLVM 21 / WASI SDK 29 emits call_indirect with a table index; eos-vm requires 0x00.
    substituteInPlace wasm/CMakeLists.txt \
      --replace-fail \
        "set(WASM_FEATURES -msign-ext -mnontrapping-fptoint -msimd128 -mbulk-memory)" \
        "set(WASM_FEATURES -msign-ext -mnontrapping-fptoint -msimd128 -mbulk-memory -mno-reference-types)"

    substituteInPlace CMakeLists.txt \
      --replace-fail \
        "-DBUILD_RELEASE_WASM=ON" \
        "-DBUILD_RELEASE_WASM=ON -DCMAKE_CXX_SCAN_FOR_MODULES=OFF -DCMAKE_C_FLAGS= -DCMAKE_CXX_FLAGS="

    # gitignore drops thirdParty JS; ExternalProject with a store path only
    # verifies the URL and never copies into resources/thirdParty/src/.
    mkdir -p packages/user/CommonApi/common/resources/thirdParty/src
    cp ${htmJs} packages/user/CommonApi/common/resources/thirdParty/src/htm.module.js
    cp ${reactJs} packages/user/CommonApi/common/resources/thirdParty/src/react.production.min.js
    cp ${reactDomJs} packages/user/CommonApi/common/resources/thirdParty/src/react-dom.production.min.js

    ${lib.concatStrings (
      lib.mapAttrsToList (rel: drv: ''
        mkdir -p packages/${rel}/dist
        cp -a ${drv}/. packages/${rel}/dist/
      '') prebuiltUiDist
    )}
  '';

  configurePhase = ''
    runHook preConfigure

    export HOME=$NIX_BUILD_TOP/home
    export TMPDIR=$NIX_BUILD_TOP/tmp
    export CARGO_HOME=$NIX_BUILD_TOP/cargo-home
    mkdir -p "$HOME" "$TMPDIR" "$CARGO_HOME" .cargo .caches/yarn

    # Nix cc-wrapper flags break WASI codegen (eos-vm rejects call_indirect
    # encodings from LLVM 21 unless the wasm target is compiled cleanly).
    unset NIX_LDFLAGS NIX_LDFLAGS_BEFORE NIX_CFLAGS_LINK LD_LIBRARY_PATH
    unset NIX_CFLAGS_COMPILE NIX_CFLAGS_COMPILE_BEFORE CFLAGS CXXFLAGS LDFLAGS
    export NIX_LDFLAGS="-L${icu}/lib -L${openssl.out}/lib -L${zlib}/lib -L${zstd}/lib"
    export CMAKE_PREFIX_PATH="${boostForCMake}:${lib.getDev openssl}:${lib.getLib openssl}:${lib.getDev icu}:${icu}"
    export CMAKE_IGNORE_PATH="/usr/lib:/usr/lib64"
    export CMAKE_SYSTEM_IGNORE_PATH="/usr/lib:/usr/lib64"
    export ICU_LIBRARY_DIR="${icu}/lib"
    export BOOST_LIBRARYDIR="${boostForCMake}/lib"
    export BOOST_INCLUDEDIR="${boostForCMake}/include"
    export SSL_CERT_FILE="${cacert}/etc/ssl/certs/ca-bundle.crt"

    cp -a ${cargoVendor}/. $NIX_BUILD_TOP/cargo-vendor
    chmod -R u+w $NIX_BUILD_TOP/cargo-vendor
    cat > .cargo/config.toml <<EOF
    [source.crates-io]
    replace-with = "vendored-sources"

    [source.vendored-sources]
    directory = "$NIX_BUILD_TOP/cargo-vendor"

    [net]
    offline = true
    EOF
    cp .cargo/config.toml "$CARGO_HOME/config.toml"

    cp -a ${yarnOfflineCache}/. .caches/yarn/
    chmod -R u+w .caches/yarn
    (
      cd packages
      yarn install --immutable --immutable-cache --mode=skip-build
    )

    mkdir -p build/wasm/deps build/wasm/boost
    cp -a ${wasmDeps}/. build/wasm/deps/
    chmod -R u+w build/wasm/deps
    rm -rf build/wasm/deps/boost
    cp -a ${wasmDeps}/boost/. build/wasm/boost/
    chmod -R u+w build/wasm/boost
    cd build
    cmake -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=$NIX_BUILD_TOP/psidk \
      -DBUILD_DEBUG_WASM=OFF \
      -DBUILD_EXAMPLES=OFF \
      -DBUILD_TESTING=OFF \
      -DBUILD_DOC=ON \
      -DENABLE_SSL=ON \
      -DWASI_SDK_PREFIX=${wasiSdk} \
      -DICU_LIBRARY_DIR=${icu}/lib \
      -DCMAKE_PREFIX_PATH="$CMAKE_PREFIX_PATH" \
      -DCMAKE_IGNORE_PATH=/usr/lib:/usr/lib64 \
      -DCMAKE_SYSTEM_IGNORE_PATH=/usr/lib:/usr/lib64 \
      -DFORCE_COLORED_OUTPUT=OFF \
      -DPSIBASE_PREBUILT_UI=ON \
      -DPSIBASE_PREBUILT_WASM_DEPS=ON \
      -DPSIBASE_PREBUILT_CLI=ON \
      -DPSIBASE_PREBUILT_PLUGINS=ON \
      -DPSIBASE_PREBUILT_WASM_SERVICES=ON \
      -DPSIBASE_PREBUILT_NATIVE=ON \
      -DPSIBASE_PREBUILT_RS_PACKAGES=ON \
      ..

    runHook postConfigure
  '';

  buildPhase = ''
    runHook preBuild
    cd "$NIX_BUILD_TOP/$sourceRoot/build"
    mkdir -p rust/release components share/psibase/wasm share/psibase/packages
    cp ${psibaseCli}/bin/psibase rust/release/psibase
    cp ${psibasePlugins}/*.wasm components/
    cp ${rsPackages}/*.psi share/psibase/packages/
    cp ${wasmServices}/bin/psinode psinode
    cp ${wasmServices}/bin/psitest psitest
    cp -a ${wasmServices}/service-wasm/. .
    if [ -d ${wasmServices}/share/psibase/wasm ]; then
      cp -a ${wasmServices}/share/psibase/wasm/. share/psibase/wasm/
    fi
    chmod -R u+w .
    ninja -j$NIX_BUILD_CORES package-index
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cd "$NIX_BUILD_TOP/$sourceRoot/build"
    install -Dm755 ${wasmServices}/bin/psinode "$out/bin/psinode"
    install -Dm755 ${wasmServices}/bin/psitest "$out/bin/psitest"
    install -Dm755 ${psibaseCli}/bin/psibase "$out/bin/psibase"

    mkdir -p $out/share/psibase
    install -Dm644 ${wasmServices}/share/psibase/config.in $out/share/psibase/config.in
    cp -a share/psibase/packages $out/share/psibase/packages
    if [ -d ${wasmServices}/share/psibase/wasm ]; then
      cp -a ${wasmServices}/share/psibase/wasm $out/share/psibase/wasm
    elif [ -d share/psibase/wasm ]; then
      cp -a share/psibase/wasm $out/share/psibase/wasm
    fi

    if [ -d share/psibase/licenses ]; then
      cp -a share/psibase/licenses $out/share/psibase/licenses
    fi
    if [ -d share/man ]; then
      cp -a share/man $out/share/man
    fi

    chmod -R u+w "$out"/bin
    find "$out"/bin -type f -exec remove-references-to -t ${rustToolchain} {} +
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    $out/bin/psibase --version
    psinodeVersion=$($out/bin/psinode --version 2>&1 || true)
    echo "psinode --version: $psinodeVersion"
    case "$psinodeVersion" in
      "psinode "*) ;;
      *)
        echo "unexpected psinode --version output" >&2
        exit 1
        ;;
    esac
    for p in \
      bin/psinode bin/psibase bin/psitest \
      share/psibase/config.in \
      share/psibase/packages \
      share/psibase/packages/index.json \
      share/psibase/packages/ProdDefault.psi \
      share/psibase/packages/Docs.psi \
      share/psibase/wasm; do
      if [ ! -e "$out/$p" ]; then
        echo "missing from layout: $p" >&2
        exit 1
      fi
    done
    if grep -aF -q "${rustToolchain}" "$out/bin/psibase" "$out/bin/psinode" "$out/bin/psitest"; then
      echo "rust toolchain store path leaked into binaries" >&2
      exit 1
    fi
    runHook postInstallCheck
  '';

  passthru = {
    inherit
      yarnOfflineCache
      cargoVendor
      wasmDepTarballs
      wasmDeps
      yarnUis
      psibaseCli
      psibasePlugins
      wasmServices
      rsPackages
      ;
  };

  meta = with lib; {
    description = "Psibase node and client, built from source";
    homepage = "https://about.psibase.io";
    license = licenses.mit;
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
    mainProgram = "psinode";
  };
}
