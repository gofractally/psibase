#pragma once

#include <psibase/AccountNumber.hpp>

namespace psibase
{
   namespace internal
   {
      extern AccountNumber sender;
      extern AccountNumber receiver;
   }  // namespace internal

   /// The account which authorized the currently-executing action
   inline AccountNumber getSender()
   {
      return internal::sender;
   }

   /// The account which received the currently-executing action
   inline AccountNumber getReceiver()
   {
      return internal::receiver;
   }
}  // namespace psibase
