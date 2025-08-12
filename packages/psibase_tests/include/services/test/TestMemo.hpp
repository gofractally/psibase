#pragma once

#include <psibase/Memo.hpp>
#include <psibase/Service.hpp>

namespace TestService
{
   struct TestMemo
   {
      static constexpr auto service = psibase::AccountNumber{"memo-service"};

      // Allow the tests to use string instead of MemoService
      // 1) using string verifies serialization compatibility between string and Memo
      // 2) using string skips validation when building the transaction, so we can
      //    get errors from the service.
#ifdef MEMO_IS_STRING
      using Memo = std::string;
#else
      using Memo = psibase::Memo;
#endif

      std::string testValue(Memo memo);
      std::string testView(psio::view<const Memo> memo);
      void        testJson(const std::string& data);
      void        testConstruct(const std::string& data);
   };
   PSIO_REFLECT(TestMemo,
                method(testValue, memo),
                method(testView, memo),
                method(testJson, memo),
                method(testConstruct, memo))
}  // namespace TestService
