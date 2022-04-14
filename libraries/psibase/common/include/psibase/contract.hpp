#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/actor.hpp>

namespace psibase
{
   /** all contracts should derive from psibase::contract */
   class contract
   {
     public:
      AccountNumber get_sender() const { return _sender; }
      AccountNumber get_receiver() const { return _receiver; }

     private:
      template <typename Contract>
      friend void dispatch(AccountNumber receiver, AccountNumber sender);

      /* called by dispatch */
      void dispatch_set_sender_receiver(AccountNumber sender, AccountNumber receiver)
      {
         _sender   = sender;
         _receiver = receiver;
      }

      AccountNumber _sender;
      AccountNumber _receiver;
   };

   template <typename Child>
   class contract2 : public contract
   {
     protected:
      struct UserContext
      {
         AccountNumber account;

         template <typename Contract>
         auto at() const
         {
            return actor<Contract>(account, Contract::contract);
         }

         operator AccountNumber() { return account; }
      };

      auto as(AccountNumber sender) { return UserContext{sender}; }

      template <typename Contract>
      auto at()
      {
         return as(Child::contract).template at<Contract>();
      }
   };

};  // namespace psibase