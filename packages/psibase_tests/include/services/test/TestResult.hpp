#pragma once

#include <psibase/Service.hpp>

#include <cstdint>
#include <string>
#include <vector>

namespace TestService
{
   /// A service whose results are annotated: `symbol` returns UTF-8 of at
   /// most 8 bytes, `names` at most 4 UTF-8 strings of at most 16 bytes
   /// (a list whose offset table is one byte wide). `relay*` call the same
   /// two actions of another account through this declaration, so the
   /// caller reads what comes back as this declaration types it.
   struct TestResult
   {
      static constexpr auto service = psibase::AccountNumber{"test-res"};

      std::string              symbol(std::uint32_t token);
      std::vector<std::string> names(std::uint32_t count);
      std::string              relay(psibase::AccountNumber callee, std::uint32_t token);
      std::string              relayView(psibase::AccountNumber callee, std::uint32_t token);
      std::vector<std::string> relayNames(psibase::AccountNumber callee, std::uint32_t count);
      std::vector<std::string> relayNamesView(psibase::AccountNumber callee, std::uint32_t count);
   };
   PSIO_REFLECT(TestResult,
                method(symbol, token, returns(utf8 | max<8>)),
                method(names, count, returns(max<4> | element(utf8 | max<16>))),
                method(relay, callee, token),
                method(relayView, callee, token),
                method(relayNames, callee, count),
                method(relayNamesView, callee, count))

   /// The same two actions with results that promise nothing: what a
   /// caller that reads them as `TestResult` declares must check.
   struct TestResultLoose
   {
      static constexpr auto service = psibase::AccountNumber{"test-loose"};

      std::string              symbol(std::uint32_t token);
      std::vector<std::string> names(std::uint32_t count);
   };
   PSIO_REFLECT(TestResultLoose, method(symbol, token), method(names, count))

   /// token 0: "USD"; 1: nine bytes; 2: bytes that are not UTF-8
   inline std::string testSymbol(std::uint32_t token)
   {
      if (token == 0)
         return "USD";
      else if (token == 1)
         return "123456789";
      else
         return "ab\xFF";
   }
   inline std::vector<std::string> testNames(std::uint32_t count)
   {
      return std::vector<std::string>(count, "alice");
   }
}  // namespace TestService
