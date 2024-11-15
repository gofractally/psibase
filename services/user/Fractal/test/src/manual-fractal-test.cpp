#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/testUtils.hpp>
#include <services/system/commonErrors.hpp>

#include "services/user/CoreFractal.hpp"
#include "services/user/Fractal.hpp"
#include "services/user/RTokens.hpp"
#include "services/user/Symbol.hpp"
#include "services/user/Tokens.hpp"

using namespace psibase;
using namespace psibase::benchmarking;
using UserService::Tokens;
using namespace UserService::Errors;
using namespace UserService;

namespace
{
   const psibase::Memo memo{"memo"};
}  // namespace

SCENARIO("Testing default psibase chain")
{
   {
      TestChain t{"tester_psinode_db", O_RDWR | O_CREAT | O_TRUNC};
      t.boot({"DevDefault"}, true);

      auto alice = t.from("alice"_a);

      auto create = alice.to<Tokens>().create(4, 1'000'000e4);
      alice.to<Tokens>().mint(create.returnVal(), 100e4, memo);

      // Create a fractal
      alice.to<FractalNs::Fractal>().createIdentity();
      alice.to<FractalNs::Fractal>().newFractal("astronauts"_a, FractalNs::CoreFractal::service);

      // Make a couple blocks
      t.finishBlock();
      t.startBlock();
      t.finishBlock();
   }

   // Run the chain
   std::system(
       "psinode -o psibase.127.0.0.1.sslip.io tester_psinode_db -l 8080 --producer firstproducer");
}
