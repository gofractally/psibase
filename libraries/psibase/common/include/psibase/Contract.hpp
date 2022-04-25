#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/actor.hpp>

namespace psibase
{
   template <typename T>
   concept HasContractName = requires(T)
   {
      {T::contract};
   };

   /** all contracts should derive from psibase::Contract */
   template <typename DerivedContract>
   class Contract
   {
     public:
      AccountNumber get_sender() const { return _sender; }
      AccountNumber get_receiver() const { return _receiver; }

      auto emit() const { return EventEmitter<DerivedContract>(_receiver); }
      auto events() const { return EventReader<DerivedContract>(_receiver); }

      auto as(AccountNumber u = AccountNumber())
      {
         if (u == AccountNumber())
            return actor<DerivedContract>(_sender, _receiver);
         return actor<DerivedContract>(u, _receiver);
      }

      template <typename T = DerivedContract>
      actor<T> at(AccountNumber callee)
      {
         return actor<T>(_receiver, callee);
      }

      template <typename T = DerivedContract>
      requires HasContractName<T> actor<T> at()
      {
         return at<T>(T::contract);
      }

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

#define PSIBASE_REFLECT_HISTORY_EVENTS(CONTRACT, ...)           \
   using CONTRACT##_EventsHistory = CONTRACT ::Events::History; \
   PSIO_REFLECT(BOOST_PP_CAT(CONTRACT, _EventsHistory), __VA_ARGS__)

#define PSIBASE_REFLECT_UI_EVENTS(CONTRACT, ...)      \
   using CONTRACT##_EventsUi = CONTRACT ::Events::Ui; \
   PSIO_REFLECT(BOOST_PP_CAT(CONTRACT, _EventsUi), __VA_ARGS__)

#define PSIBASE_REFLECT_MERKLE_EVENTS(CONTRACT, ...)          \
   using CONTRACT##_EventsMerkle = CONTRACT ::Events::Merkle; \
   PSIO_REFLECT(BOOST_PP_CAT(CONTRACT, _EventsMerkle), __VA_ARGS__)
