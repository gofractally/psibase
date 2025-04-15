#pragma once

#include <concepts>
#include <psibase/AccountNumber.hpp>
#include <psibase/Actor.hpp>
#include <psibase/Table.hpp>

namespace psibase
{

   template <typename Service>
   struct RecursionGuard
   {
      static bool running;
      RecursionGuard()
      {
         check(!running, "Cannot reenter service");
         running = true;
      }
      ~RecursionGuard() { running = false; }
   };

   template <typename Service>
   bool RecursionGuard<Service>::running = false;

   template <typename Service>
   struct RecursiveActor : Actor<Service>
   {
      bool prevRunning;
      RecursiveActor(AccountNumber sender, AccountNumber receiver)
          : Actor<Service>{sender, receiver}
      {
         prevRunning                      = RecursionGuard<Service>::running;
         RecursionGuard<Service>::running = false;
      }
      ~RecursiveActor() { RecursionGuard<Service>::running = prevRunning; }
   };

   namespace detail
   {
      template <typename T>
      struct CanOpenTable
      {
         template <typename U>
         using fn = std::bool_constant<requires(U&& u) { u.template open<T>(); }>;
      };

      template <DbId db, typename T>
      struct CanOpenTableDb
      {
         template <typename U>
         using fn = std::bool_constant<db == U::db&& requires(U&& u) { u.template open<T>(); }>;
      };

      template <DbId db>
      struct IsDb
      {
         template <typename U>
         using fn = std::bool_constant<db == U::db>;
      };
   };  // namespace detail

   /// Services may optionally inherit from this to gain the [emit] and [events] convenience methods
   ///
   class Service
   {
     public:
#ifdef __wasm32__

      /// Open a table by index
      ///
      /// The tables must be reflected using `PSIBASE_REFLECT_TABLES`.
      ///
      /// ```c++
      /// void MyService::act() {
      ///    auto table = open<DbId::service, 1>();
      /// }
      /// ```
      template <DbId db, std::uint16_t table, typename DerivedService>
      auto open(this const DerivedService&)
      {
         using AllTables = decltype(psibase_get_tables((DerivedService*)nullptr));
         constexpr auto index =
             boost::mp11::mp_find_if<AllTables, detail::IsDb<db>::template fn>::value;
         return boost::mp11::mp_at_c<AllTables, index>(DerivedService::service)
             .template open<table>();
      }

      /// Open a table in a specific db, by table or record type
      ///
      /// The db can only contain one instance of the table.  The
      /// tables must be reflected using `PSIBASE_REFLECT_TABLES`.
      ///
      /// ```c++
      /// void MyService::act() {
      ///    auto table = open<DbId::service, MyTable>();
      /// }
      /// ```
      template <DbId db, typename T, typename DerivedService>
      auto open(this const DerivedService&)
      {
         using AllTables = decltype(psibase_get_tables((DerivedService*)nullptr));
         constexpr auto index =
             boost::mp11::mp_find_if<AllTables, detail::CanOpenTableDb<db, T>::template fn>::value;
         return boost::mp11::mp_at_c<AllTables, index>(DerivedService::service).template open<T>();
      }

      /// Open a table by table or record type
      ///
      /// There can only be one instance of the table in the service.
      /// The tables must be reflected using `PSIBASE_REFLECT_TABLES`.
      ///
      /// ```c++
      /// void MyService::act() {
      ///    auto table = open<MyTable>();
      /// }
      /// ```
      template <typename T, typename DerivedService>
      auto open(this const DerivedService&)
      {
         using AllTables = decltype(psibase_get_tables((DerivedService*)nullptr));
         constexpr auto index =
             boost::mp11::mp_find_if<AllTables, detail::CanOpenTable<T>::template fn>::value;
         return boost::mp11::mp_at_c<AllTables, index>(DerivedService::service).template open<T>();
      }

      /// Emit events
      ///
      /// The following examples use the example definitions in [Defining Events](#defining-events). After you have defined your events, you can use `emit` to emit them. Examples:
      ///
      /// ```
      /// auto eventANumber = this->emit().history().myEvent(a, s);
      /// auto eventBNumber = this->emit().ui().updateDisplay();
      /// auto eventCNumber = this->emit().merkle().credit(from, to, amount);
      /// ```
      ///
      /// These functions return a `psibase::EventNumber`, aka `uint64_t`, which uniquely identifies the event. This number supports lookup; see [Service::events].
      ///
      /// `emit` is just a convenience method with the following definition:
      /// ```c++
      /// EventEmitter<DerivedService> emit() const
      /// {
      ///    return EventEmitter<DerivedService>();
      /// }
      /// ```
      ///
      /// Here's how to do the above when the service doesn't inherit from `psibase::Service`:
      ///
      /// ```
      /// EventEmitter<MyService> emitter;
      /// auto eventANumber = emitter.history().myEvent(a, s);
      /// auto eventBNumber = emitter.ui().updateDisplay();
      /// auto eventCNumber = emitter.merkle().credit(from, to, amount);
      /// ```
      template <typename DerivedService>
      EventEmitter<DerivedService> emit(this const DerivedService&)
      {
         return EventEmitter<DerivedService>();
      }

      /// Read events
      ///
      /// The following examples use the example definitions in [Defining Events](#defining-events). After you have defined your events, you can use `events` to read them. Examples:
      ///
      /// ```
      /// auto eventAArguments = this->events().history().myEvent(eventANumber).unpack();
      /// auto eventBArguments = this->events().ui().updateDisplay(eventBNumber).unpack();
      /// auto eventCArguments = this->events().merkle().credit(eventCNumber).unpack();
      /// ```
      ///
      /// These functions take a `psibase::EventNumber`, aka `uint64_t`, which uniquely identifies the event. These numbers were generated by [Service::emit].
      ///
      /// The functions return `psio::shared_view_ptr<std::tuple<event argument types>>`. You can get the tuple using `unpack()`, like above.
      ///
      /// There are restrictions on when events can be read; see the following for details:
      ///
      /// - [DbId::historyEvent]
      /// - [DbId::uiEvent]
      /// - [DbId::merkleEvent]
      ///
      /// `events` is just a convenience method with the following definition:
      /// ```c++
      /// EventReader<DerivedService> events() const
      /// {
      ///    return EventReader<DerivedService>();
      /// }
      /// ```
      ///
      /// Here's how to do the above when the service doesn't inherit from `psibase::Service`:
      ///
      /// ```
      /// auto EventReader<MyService> reader;
      /// auto eventAArguments = reader.history().myEvent(eventANumber).unpack();
      /// auto eventBArguments = reader.ui().updateDisplay(eventBNumber).unpack();
      /// auto eventCArguments = reader.merkle().credit(eventCNumber).unpack();
      /// ```
      template <typename DerivedService>
      EventReader<DerivedService> events(this const DerivedService&)
      {
         return EventReader<DerivedService>(DerivedService::service);
      }

      /// Allow synchronous calls to re-enter the service
      ///
      /// The service is responsible for ensuring correctness:
      /// - All tables should be in a consistent state when a recursive call is made.
      /// - Local variables that shadow table rows may not be valid after a recursive call returns.
      ///
      /// This only allows a single level of recursion. If an action that is called
      /// recursively itself needs to make a recursive call, it must also enable recursion.
      ///
      /// ```
      /// recurse().foo();
      /// ```
      template <typename DerivedService>
      RecursiveActor<DerivedService> recurse(this const DerivedService&)
      {
         auto receiver = getReceiver();
         return {receiver, receiver};
      }
#endif
   };  // Service
};  // namespace psibase

#define PSIBASE_REFLECT_EVENTS(SERVICE)       \
   using SERVICE##_Events = SERVICE ::Events; \
   PSIO_REFLECT(SERVICE##_Events)

#define PSIBASE_REFLECT_HISTORY_EVENTS(SERVICE, ...)          \
   using SERVICE##_EventsHistory = SERVICE ::Events::History; \
   PSIO_REFLECT(SERVICE##_EventsHistory, __VA_ARGS__)

#define PSIBASE_REFLECT_UI_EVENTS(SERVICE, ...)     \
   using SERVICE##_EventsUi = SERVICE ::Events::Ui; \
   PSIO_REFLECT(SERVICE##_EventsUi, __VA_ARGS__)

#define PSIBASE_REFLECT_MERKLE_EVENTS(SERVICE, ...)         \
   using SERVICE##_EventsMerkle = SERVICE ::Events::Merkle; \
   PSIO_REFLECT(SERVICE##_EventsMerkle, __VA_ARGS__)

#define PSIBASE_REFLECT_TABLES(SERVICE, ...) \
   boost::mp11::mp_list<__VA_ARGS__> psibase_get_tables(SERVICE*);
