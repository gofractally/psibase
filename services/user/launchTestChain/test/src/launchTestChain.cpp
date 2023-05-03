#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/testUtils.hpp>
#include <services/system/commonErrors.hpp>

#include "services/user/CoreFractalSys.hpp"
#include "services/user/FractalSys.hpp"
#include "services/user/RTokenSys.hpp"
#include "services/user/SymbolSys.hpp"
#include "services/user/TokenSys.hpp"

using namespace psibase;
using namespace psibase::benchmarking;
using UserService::TokenSys;
using namespace UserService::Errors;
using namespace UserService;

namespace
{
   const psibase::Memo memo{"memo"};
}  // namespace

SCENARIO("Testing default psibase chain")
{
   DefaultTestChain t({}, 1ull << 32, 1ull << 32, 1ull << 32, 1ull << 32);

   auto tokenSysRpc = t.from(RTokenSys::service).to<RTokenSys>();

   // New UI
   std::string rpcUiDir = "../services/user/TokenSys/ui/dist/";
   tokenSysRpc.storeSys("/index.html", "text/html", readWholeFile(rpcUiDir + "index.html"));
   tokenSysRpc.storeSys("/index.js", "text/javascript", readWholeFile(rpcUiDir + "index.js"));
   tokenSysRpc.storeSys("/style.css", "text/css", readWholeFile(rpcUiDir + "style.css"));
   tokenSysRpc.storeSys("/loader.svg", "image/svg+xml", readWholeFile(rpcUiDir + "loader.svg"));
   tokenSysRpc.storeSys("/app-wallet-icon.svg", "image/svg+xml",
                        readWholeFile(rpcUiDir + "app-wallet-icon.svg"));
   tokenSysRpc.storeSys("/arrow-up-solid.svg", "image/svg+xml",
                        readWholeFile(rpcUiDir + "arrow-up-solid.svg"));

   auto alice     = t.from(t.add_account("alice"_a));
   auto bob       = t.from(t.add_account("bob"_a));
   auto sysIssuer = t.from(SymbolSys::service).to<TokenSys>();
   auto sysToken  = TokenSys::sysToken;

   // Let sys token be tradeable
   sysIssuer.setTokenConf(sysToken, "untradeable"_m, false);

   // Distribute a few tokens
   auto userBalance = 1'000'000e8;
   sysIssuer.mint(sysToken, userBalance, memo);
   sysIssuer.credit(sysToken, alice, 1'000e8, memo);
   sysIssuer.credit(sysToken, bob, 1'000e8, memo);

   auto create = alice.to<TokenSys>().create(4, 1'000'000e4);
   alice.to<TokenSys>().mint(create.returnVal(), 100e4, memo);

   // Create a fractal
   alice.to<Fractal::FractalSys>().createIdentity();
   alice.to<Fractal::FractalSys>().newFractal("astronauts"_a, Fractal::CoreFractalSys::service);

   // Make a couple blocks
   t.finishBlock();
   t.startBlock();
   t.finishBlock();

   // Run the chain
   std::system("rm -rf tester_psinode_db");
   std::system("mkdir tester_psinode_db");
   std::system(("cp -a " + t.getPath() + "/. tester_psinode_db/").c_str());
   std::system(
       "psinode -o psibase.127.0.0.1.sslip.io tester_psinode_db -l 8080 --producer firstproducer");
}
