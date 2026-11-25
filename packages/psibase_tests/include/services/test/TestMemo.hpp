#pragma once

#include <psibase/Memo.hpp>
#include <psibase/Service.hpp>

namespace TestService
{
   struct TestMemo
   {
      static constexpr auto service = psibase::AccountNumber{"memo-svc"};

      using Memo = psibase::Memo;

      std::string testValue(Memo memo);
      std::string testView(psio::pssz_view<Memo> memo);
      void        testJson(const std::string& memo);
      void        testConstruct(const std::string& memo);
   };
   PSIO_REFLECT(TestMemo,
                method(testValue, memo),
                method(testView, memo),
                method(testJson, memo),
                method(testConstruct, memo))
}  // namespace TestService
