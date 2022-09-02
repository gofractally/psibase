#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/testUtils.hpp>
#include <services/system/commonErrors.hpp>

#include "services/user/RTokenSys.hpp"
#include "services/user/SymbolSys.hpp"
#include "services/user/TokenSys.hpp"

using namespace psibase;
using namespace psibase::benchmarking;
using UserContract::TokenSys;
using namespace UserContract::Errors;
using namespace UserContract;

namespace
{
   const psibase::String memo{"memo"};

   const std::vector<std::pair<AccountNumber, const char*>> neededContracts = {
       {TokenSys::service, "TokenSys.wasm"},
       {NftSys::service, "NftSys.wasm"},
       {SymbolSys::service, "SymbolSys.wasm"},
       {RTokenSys::service, "RTokenSys.wasm"}};
}  // namespace

SCENARIO("Testing default psibase chain")
{
   DefaultTestChain t(neededContracts, 1'000'000'000ul, 32, 32, 32, 38);

   auto tokenSysRpc = t.as(RTokenSys::service).at<RTokenSys>();

   // Old UI
   std::string comUiDir = "../services/user/CommonSys/ui/vanilla/";
   tokenSysRpc.storeSys("/index.html", "text/html", readWholeFile(comUiDir + "common.index.html"));
   std::string rpcUiDir = "../services/user/TokenSys/ui/vanilla/";
   tokenSysRpc.storeSys("/ui/index.js", "text/javascript", readWholeFile(rpcUiDir + "index.js"));

   // New UI
   // std::string rpcUiDir    = "../services/user/TokenSys/ui/dist/";
   // tokenSysRpc.storeSys("/index.html", "text/html", readWholeFile(rpcUiDir + "index.html"));
   // tokenSysRpc.storeSys("/index.js", "text/javascript", readWholeFile(rpcUiDir + "index.js"));
   // tokenSysRpc.storeSys("/style.css", "text/css", readWholeFile(rpcUiDir + "style.css"));
   // tokenSysRpc.storeSys("/vite.svg", "image/svg+xml", readWholeFile(rpcUiDir + "vite.svg"));

   auto alice = t.as(t.add_account("alice"_a));
   auto bob   = t.as(t.add_account("bob"_a));

   // Initialize user contracts
   alice.at<NftSys>().init();
   alice.at<TokenSys>().init();
   alice.at<SymbolSys>().init();

   auto sysIssuer = t.as(SymbolSys::service).at<TokenSys>();
   auto sysToken  = TokenSys::sysToken;

   // Let sys token be tradeable
   sysIssuer.setTokenConf(sysToken, "untradeable"_m, false);

   // Distribute a few tokens
   auto userBalance = 1'000'000e8;
   sysIssuer.mint(sysToken, userBalance, memo);
   sysIssuer.credit(sysToken, alice, 1'000e8, memo);
   sysIssuer.credit(sysToken, bob, 1'000e8, memo);

   auto create = alice.at<TokenSys>().create(4, 1'000'000e4);
   alice.at<TokenSys>().mint(create.returnVal(), 100e4, memo);

   t.startBlock();

   /****** At t.getPath(): 
      drwxr-xr-x block_log
      drwxr-xr-x state
      drwxr-xr-x subjective
      drwxr-xr-x write_only
      ******/

   // Make a couple block
   t.finishBlock();
   t.startBlock();
   t.finishBlock();
   // Run the chain
   psibase::execute("rm -rf tester_psinode_db");
   psibase::execute("mkdir tester_psinode_db");
   psibase::execute("cp -a " + t.getPath() + "/. tester_psinode_db/");
   psibase::execute(
       "psinode --slow -o psibase.127.0.0.1.sslip.io tester_psinode_db --producer testchain");
}
