#include <psibase/tester.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/Producers.hpp>
#include <services/system/SetCode.hpp>
#include <services/test/SetWasmConfig.hpp>
#include <services/test/VerifyWithCall.hpp>
#include <services/user/Sites.hpp>

using namespace psibase;
using namespace SystemService;
using namespace TestService;

int main(int argc, const char* const* argv)
{
   if (argc < 2)
      return 1;
   TestChain chain(argv[1]);
   int       numAccounts = argc < 3 ? 32 : std::atoi(argv[2]);
   int       numMemories = argc < 4 ? 32 : std::atoi(argv[3]);
   chain.boot({"Minimal", "Explorer"}, true);

   auto nopCode = readWholeFile("Nop.wasm");

   transactor<Accounts> accounts;
   transactor<SetCode>  setCode;

   AccountNumber alice{"alice"};
   chain.to<Accounts>().newAccount(alice, AuthAny::service, true);

   expect(chain.pushTransaction(chain.makeTransaction(
       {accounts.newAccount(SetWasmConfig::service, AuthAny::service, true),
        setCode.from(SetWasmConfig::service)
            .setCode(SetWasmConfig::service, 0, 0, readWholeFile("SetWasmConfig.wasm")),
        setCode.setFlags(SetWasmConfig::service, SetWasmConfig::flags)})));

   expect(chain.pushTransaction(chain.makeTransaction(
       {accounts.newAccount(VerifyWithCall::service, AuthAny::service, true),
        setCode.from(VerifyWithCall::service)
            .setCode(VerifyWithCall::service, 0, 0, readWholeFile("VerifyWithCall.wasm")),
        setCode.setFlags(VerifyWithCall::service, VerifyWithCall::flags)})));

   std::vector<Action> sigdata;
   for (auto i : std::views::iota(0, numAccounts))
   {
      AccountNumber account{"nop" + std::to_string(i)};

      transactor<SetCode> setFlags{SetCode::service, SetCode::service};

      expect(chain.pushTransaction(
          chain.makeTransaction({accounts.newAccount(account, AuthAny::service, true),
                                 setCode.from(account).setCode(account, 0, 0, nopCode),
                                 setCode.setFlags(account, VerifyWithCall::flags)})));
      sigdata.push_back({.sender = VerifyWithCall::service, .service = account});
   }

   auto sign = [result = psio::to_frac(sigdata)](std::span<const char>) { return result; };

   chain.setAutoBlockStart(false);
   chain.startBlock();
   chain.startBlock();
   auto prod =
       chain.kvGet<StatusRow>(StatusRow::db, statusKey()).value().head.value().header.producer;
   expect(chain.to<Producers>()
              .setProducers(std::vector{Producer{prod, Claim{.service = VerifyWithCall::service}}})
              .trace());
   auto wasmConfig =
       chain.kvGet<WasmConfigRow>(WasmConfigRow::db, WasmConfigRow::key(proofWasmConfigTable))
           .value_or(WasmConfigRow{});
   wasmConfig.numExecutionMemories = numMemories;
   expect(chain.to<SetWasmConfig>().setWasmCfg(proofWasmConfigTable, wasmConfig).trace());
   chain.startBlock();
   chain.startBlock();
   chain.finishBlock(sign);
   chain.startBlock();
   std::string_view content{"Lorem ipsum dolor sit amet"};
   chain.from(alice).to<Sites>().storeSys("/file.txt", "text/plain", std::nullopt,
                                          std::vector<char>{content.begin(), content.end()});
   chain.finishBlock();
}
