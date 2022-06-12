#define CATCH_CONFIG_MAIN

#include <contracts/system/commonErrors.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/testUtils.hpp>

#include "contracts/user/RTokenSys.hpp"
#include "contracts/user/SymbolSys.hpp"
#include "contracts/user/TokenSys.hpp"

using namespace psibase;
using namespace psibase::benchmarking;
using UserContract::TokenSys;
using namespace UserContract::Errors;
using namespace UserContract;

namespace
{
   const psibase::String memo{"memo"};

   const std::vector<std::pair<AccountNumber, const char*>> neededContracts = {
       {TokenSys::contract, "TokenSys.wasm"},
       {NftSys::contract, "NftSys.wasm"},
       {SymbolSys::contract, "SymbolSys.wasm"},
       {RpcTokenSys::contract, "RTokenSys.wasm"}};
}  // namespace

SCENARIO("Testing default psibase chain")
{
   DefaultTestChain t(neededContracts);

   auto        rpcTokenSys = t.as(RpcTokenSys::contract).at<RpcTokenSys>();
   std::string rpcUiDir    = "../contracts/user/TokenSys/ui/";
   rpcTokenSys.storeSys("/", "text/html", read_whole_file(rpcUiDir + "index.html"));
   rpcTokenSys.storeSys("/ui/index.js", "text/javascript", read_whole_file(rpcUiDir + "index.js"));

   auto alice = t.as(t.add_account("alice"_a));
   auto bob   = t.as(t.add_account("bob"_a));

   // Initialize user contracts
   alice.at<NftSys>().init();
   alice.at<TokenSys>().init();
   alice.at<SymbolSys>().init();

   auto sysIssuer = t.as(SymbolSys::contract).at<TokenSys>();
   auto sysToken  = TokenSys::sysToken;

   // Let sys token be tradeable
   sysIssuer.setTokenConf(sysToken, "untradeable"_m, false);

   // Distribute a few tokens
   auto userBalance = 1'000'000e8;
   sysIssuer.mint(sysToken, userBalance, memo);
   sysIssuer.credit(sysToken, alice, 1'000e8, memo);
   sysIssuer.credit(sysToken, bob, 1'000e8, memo);

   t.start_block();

   /****** At t.get_path(): 
      drwxr-xr-x block_log
      drwxr-xr-x state
      drwxr-xr-x subjective
      drwxr-xr-x write_only
      ******/

   // Make a couple block
   t.finish_block();
   t.start_block();
   t.finish_block();
   // Run the chain
   psibase::execute("rm -rf tester_psinode_db");
   psibase::execute("mkdir tester_psinode_db");
   psibase::execute("cp -a " + t.get_path() + "/. tester_psinode_db/");
   psibase::execute("psinode -p -o psibase.127.0.0.1.sslip.io tester_psinode_db");
}