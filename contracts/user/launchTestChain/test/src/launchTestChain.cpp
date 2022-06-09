#define CATCH_CONFIG_MAIN

#include "symbol_sys.hpp"
#include "token_sys.hpp"

#include <contracts/system/common_errors.hpp>
#include <contracts/user/rpc_token_sys.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/testUtils.hpp>

using namespace psibase;
using namespace psibase::benchmarking;
using UserContract::TokenSys;
using namespace UserContract::Errors;
using namespace UserContract;

namespace
{
   const psibase::String memo{"memo"};

   const std::vector<std::pair<AccountNumber, const char*>> neededContracts = {
       {TokenSys::contract, "token_sys.wasm"},
       {NftSys::contract, "nft_sys.wasm"},
       {SymbolSys::contract, "symbol_sys.wasm"},
       {RpcTokenSys::contract, "rpc_token_sys.wasm"}};
}  // namespace

SCENARIO("Testing psibase")
{
   GIVEN("An empty chain with user Alice")
   {
      DefaultTestChain t(neededContracts);

      auto        rpcTokenSys = t.as(RpcTokenSys::contract).at<RpcTokenSys>();
      std::string rpcUiDir    = "../contracts/user/rpc_token_sys/ui/";
      rpcTokenSys.storeSys("/", ContentTypes::html, read_whole_file(rpcUiDir + "index.html"));
      rpcTokenSys.storeSys("/ui/index.js", ContentTypes::js,
                           read_whole_file(rpcUiDir + "index.js"));

      auto alice = t.as(t.add_account("alice"_a));
      auto bob   = t.as(t.add_account("bob"_a));

      // Initialize user contracts
      alice.at<NftSys>().init();
      alice.at<TokenSys>().init();
      alice.at<SymbolSys>().init();

      auto sysIssuer   = t.as(SymbolSys::contract).at<TokenSys>();
      auto userBalance = 1'000'000e8;
      auto sysToken    = TokenSys::sysToken;
      sysIssuer.mint(sysToken, userBalance, memo);

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
}