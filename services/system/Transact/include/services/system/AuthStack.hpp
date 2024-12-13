#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>
#include <vector>

namespace SystemService
{
   // For use in auth services to track the stack of accounts in an authorization chain
   //
   // This is used to prevent infinite recursion in auth services.
   class AuthStack
   {
     public:
      std::vector<psibase::AccountNumber> senders;

      static AuthStack& instance()
      {
         static AuthStack instance;
         return instance;
      }

      void push(const psibase::AccountNumber& sender) { senders.push_back(sender); }

      void pop()
      {
         if (!senders.empty())
         {
            senders.pop_back();
         }
      }

      bool inStack(const psibase::AccountNumber& sender) const
      {
         return std::ranges::find(senders, sender) != senders.end();
      }

     private:
      AuthStack()                            = default;
      AuthStack(const AuthStack&)            = delete;
      AuthStack& operator=(const AuthStack&) = delete;
   };

   class AuthStackGuard
   {
     public:
      AuthStackGuard(const psibase::AccountNumber& sender) { AuthStack::instance().push(sender); }
      ~AuthStackGuard() { AuthStack::instance().pop(); }
   };
}  // namespace SystemService
