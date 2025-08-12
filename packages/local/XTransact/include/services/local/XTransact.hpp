#pragma once

#include <psibase/Service.hpp>

namespace LocalService
{
   enum class TransactionCallbackType : std::uint32_t
   {
      nextTransaction,
      preverifyTransaction
   };

   struct XTransact : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-transact"};
      void addCallback(TransactionCallbackType type, psibase::MethodNumber callback);
      void removeCallback(TransactionCallbackType type, psibase::MethodNumber callback);
   };
   PSIO_REFLECT(XTransact, method(addCallback, type, action), method(removeCallback, type, action))
}  // namespace LocalService
