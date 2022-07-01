#pragma once

#include <psibase/DefaultTestChain.hpp>
#include "FractallySys.hpp"

using namespace psibase;
using UserContract::FractallySys;

class FractallyChainHelper {
public: 
   static void addFractal(DefaultTestChain &t, psibase::test_chain::ContractUser<UserContract::FractallySys> f) {
      f.init();
      f.createFractal("FirstFractal");
   };
};
