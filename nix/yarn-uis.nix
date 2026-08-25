# Per-UI Yarn/Vite packages. Each has a tight fileset so a C++ change does not
# rebuild Vite. XAdmin is omitted (cargo-component + jco in its yarn build).
{
  lib,
  stdenvNoCC,
  yarnBerry,
  nodejs20,
  cacert,
  yarnOfflineCache,
  version ? "0.27.0",
}:

let
  inherit (lib) fileset;
  packagesDir = ../packages;

  workspaceMeta = fileset.unions [
    (packagesDir + "/yarn.lock")
    (packagesDir + "/package.json")
    (packagesDir + "/.yarnrc.yml")
    (packagesDir + "/if-build-needed.mjs")
    (packagesDir + "/build.shared.mjs")
    (packagesDir + "/vite.shared.ts")
    (packagesDir + "/eslint.config.mjs")
    (packagesDir + "/prettier.config.cjs")
    (packagesDir + "/tsconfig.json")
    (packagesDir + "/tsconfig.base.json")
    (packagesDir + "/tsconfig.app.json")
    (packagesDir + "/tsconfig.node.json")
    (packagesDir + "/components.json")
    (fileset.fileFilter (file: file.name == "package.json") packagesDir)
  ];

  # Flake copy is git-filtered, so gitignored dist/node_modules are not in these trees.
  commonLibFiles = packagesDir + "/user/CommonApi/common/packages/common-lib";
  sharedUiFiles = packagesDir + "/shared-ui";

  mkYarnUi =
    {
      pname,
      workspace,
      relPath,
      extraFileset ? null,
      extraBuild ? "",
      withSharedUi ? true,
      commonLibDist ? null,
    }:
    stdenvNoCC.mkDerivation {
      inherit pname version;
      src = fileset.toSource {
        root = packagesDir;
        fileset = fileset.unions (
          [
            workspaceMeta
            commonLibFiles
            (packagesDir + "/${relPath}")
          ]
          ++ lib.optional withSharedUi sharedUiFiles
          ++ lib.optional (extraFileset != null) extraFileset
        );
      };

      nativeBuildInputs = [
        yarnBerry
        nodejs20
        cacert
      ];

      dontConfigure = true;
      dontFixup = true;

      YARN_ENABLE_TELEMETRY = "0";
      YARN_ENABLE_NETWORK = "0";
      YARN_ENABLE_OFFLINE_MODE = "true";
      COREPACK_ENABLE_NETWORK = "0";
      PSIREBUILD = "true";
      SSL_CERT_FILE = "${cacert}/etc/ssl/certs/ca-bundle.crt";

      buildPhase = ''
        runHook preBuild
        export HOME=$NIX_BUILD_TOP/home
        mkdir -p "$HOME" "$NIX_BUILD_TOP/.caches/yarn"
        cp -a ${yarnOfflineCache}/. "$NIX_BUILD_TOP/.caches/yarn/"
        chmod -R u+w "$NIX_BUILD_TOP/.caches/yarn"
        yarn install --immutable --immutable-cache --mode=skip-build
        ${lib.optionalString (commonLibDist != null) ''
          mkdir -p user/CommonApi/common/packages/common-lib/dist
          cp -a ${commonLibDist}/. user/CommonApi/common/packages/common-lib/dist/
        ''}
        ${extraBuild}
        yarn workspace ${workspace} build
        runHook postBuild
      '';

      installPhase = ''
        runHook preInstall
        mkdir -p "$out"
        cp -a ${relPath}/dist/. "$out/"
        runHook postInstall
      '';

      doInstallCheck = true;
      installCheckPhase = ''
        runHook preInstallCheck
        if [ "${workspace}" = "@psibase/common-lib" ]; then
          test -f "$out/common-lib.js"
        else
          test -f "$out/index.html"
        fi
        runHook postInstallCheck
      '';
    };

  mkApp = args: mkYarnUi (args // { commonLibDist = common-lib; });

  common-lib = mkYarnUi {
    pname = "psibase-ui-common-lib";
    workspace = "@psibase/common-lib";
    relPath = "user/CommonApi/common/packages/common-lib";
    withSharedUi = false;
  };
in
{
  inherit common-lib;

  accounts = mkApp {
    pname = "psibase-ui-accounts";
    workspace = "@psibase/accounts-ui";
    relPath = "system/Accounts/ui";
  };
  evaluations = mkApp {
    pname = "psibase-ui-evaluations";
    workspace = "@psibase/evaluations-ui";
    relPath = "user/Evaluations/ui";
  };
  fractals = mkApp {
    pname = "psibase-ui-fractals";
    workspace = "@psibase/fractals-ui";
    relPath = "user/Fractals/ui";
  };
  fractal-core = mkApp {
    pname = "psibase-ui-fractal-core";
    workspace = "@psibase/fractal-core-ui";
    relPath = "user/FractalCore/ui";
  };
  token-stream = mkApp {
    pname = "psibase-ui-token-stream";
    workspace = "token-stream";
    relPath = "user/TokenStream/ui";
  };
  plugin-tester = mkApp {
    pname = "psibase-ui-plugin-tester";
    workspace = "@psibase/plugin-tester-ui";
    relPath = "user/CommonApi/common/packages/plugin-tester/ui";
  };
  explorer = mkApp {
    pname = "psibase-ui-explorer";
    workspace = "@psibase/explorer-ui";
    relPath = "user/Explorer/ui";
    extraFileset = packagesDir + "/user/CommonApi/common/resources/useGraphQLQuery.d.ts";
    extraBuild = "yarn workspace @psibase/explorer-ui prepare";
  };
  homepage = mkApp {
    pname = "psibase-ui-homepage";
    workspace = "@psibase/homepage-ui";
    relPath = "user/Homepage/ui";
  };
  identity = mkApp {
    pname = "psibase-ui-identity";
    workspace = "@psibase/identity-ui";
    relPath = "user/Identity/ui";
  };
  permissions = mkApp {
    pname = "psibase-ui-permissions";
    workspace = "@psibase/permissions-ui";
    relPath = "user/Permissions/ui";
  };
  supervisor = mkApp {
    pname = "psibase-ui-supervisor";
    workspace = "@psibase/supervisor-ui";
    relPath = "user/Supervisor/ui";
  };
  workshop = mkApp {
    pname = "psibase-ui-workshop";
    workspace = "@psibase/workshop-ui";
    relPath = "user/Workshop/ui";
  };
  config = mkApp {
    pname = "psibase-ui-config";
    workspace = "@psibase/config-ui";
    relPath = "user/Config/ui";
  };
  xproxy = mkApp {
    pname = "psibase-ui-xproxy";
    workspace = "@psibase/xproxy-ui";
    relPath = "local/XProxy/ui";
  };
}
