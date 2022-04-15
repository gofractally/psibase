#pragma once

#include <psibase/AccountNumber.hpp>

namespace psibase
{
   /** all contracts should derive from psibase::Contract */
   class Contract
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
};  // namespace psibase
