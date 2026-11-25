// What a call costs in memory. Actor packs a call into one buffer: the
// arguments are written into the action (psio::method_args_packed), and an
// action that is itself an argument (a LazyAction) into the call around it.
// Measured here against the two-step encoding (the arguments, then the
// action around their bytes), which is what Actor did before: the bytes are
// the same, the allocations are not. Native only: this file replaces the
// global operator new to count.
#include <catch2/catch_all.hpp>

#include <psibase/Actor.hpp>
#include <psibase/Rpc.hpp>

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <algorithm>
#include <new>
#include <span>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

using namespace psibase;

namespace
{
   // `buffers` counts the allocations that could hold a message (the
   // others are a few bytes each: names, headers).
   constexpr std::size_t bufferSize = 64 * 1024;
   std::size_t           live = 0, peak = 0, buffers = 0;

   // The most that was live at once beside what was live at the start, and
   // the number of buffers allocated, since construction.
   struct HeapWindow
   {
      std::size_t before;
      HeapWindow() : before(live)
      {
         peak    = live;
         buffers = 0;
      }
      std::size_t peakBytes() const { return peak - before; }
      std::size_t count() const { return buffers; }
   };
}  // namespace

void* operator new(std::size_t n)
{
   auto* p = static_cast<std::size_t*>(std::malloc(n + 16));
   if (!p)
      throw std::bad_alloc{};
   *p = n;
   live += n;
   if (n >= bufferSize)
      ++buffers;
   if (live > peak)
      peak = live;
   return reinterpret_cast<char*>(p) + 16;
}
void operator delete(void* p) noexcept
{
   if (!p)
      return;
   auto* q = reinterpret_cast<std::size_t*>(static_cast<char*>(p) - 16);
   live -= *q;
   std::free(q);
}
void operator delete(void* p, std::size_t) noexcept
{
   operator delete(p);
}

namespace in_place_test
{
   struct Payload
   {
      std::uint32_t     expiration = 0;
      std::vector<char> data;
      PSIO_REFLECT(Payload, expiration, data)
   };

   // The shapes of Transact::execTrx, XRun::post, RTransact::recv,
   // HttpServer::sendProds and HttpServer::sendReply
   struct Exec
   {
      static constexpr auto service = AccountNumber{"exec"};
      void                  execTrx(psio::pssz_view<Payload> trx, bool speculative) {}
      void                  recv(psio::pssz_view<Payload> trx) {}
   };
   PSIO_REFLECT(Exec, method(execTrx, trx, speculative), method(recv, trx))

   struct Runner
   {
      static constexpr auto service = AccountNumber{"runner"};
      std::uint64_t post(std::uint8_t mode, Action action, std::uint32_t maxTime, MethodNumber callback)
      {
         return 0;
      }
      void sendProds(const Action& action) {}
      void sendReply(std::int32_t socket, HttpReply response) {}
   };
   PSIO_REFLECT(Runner,
                method(post, mode, action, maxTime, callback),
                method(sendProds, action),
                method(sendReply, socket, response))

   struct Events
   {
      void stored(AccountNumber who, std::vector<char> data) {}
   };
   PSIO_REFLECT(Events, method(stored, who, data))

   template <typename T, std::size_t I, typename... Args>
   Action twoStep(AccountNumber sender, AccountNumber service, Args&&... args)
   {
      return Action{sender, service, MethodNumber{psio::reflect<T>::template method_name<I>},
                    psio::method_args_to_pssz<T, I>(std::forward<Args>(args)...)};
   }

   // What `f` returns, kept while the heap is read, with the peak and the
   // number of buffers allocated in making it.
   template <typename R>
   struct Measured
   {
      R           value;
      std::size_t peak  = 0;
      std::size_t count = 0;
   };
   template <typename F>
   auto measure(F&& f)
   {
      HeapWindow heap;
      auto       value = f();
      auto       p     = heap.peakBytes();
      auto       n     = heap.count();
      return Measured<decltype(value)>{std::move(value), p, n};
   }
   std::span<const char> bytesOf(const std::vector<char>& packed)
   {
      return packed;
   }
   template <typename T>
   std::span<const char> bytesOf(const psio::pssz_buffer<T>& packed)
   {
      return packed.bytes();
   }
}  // namespace in_place_test

using namespace in_place_test;

TEST_CASE("in place: a call is one buffer of its size", "[methods][alloc]")
{
   constexpr std::size_t size = 1 << 20;
   const AccountNumber   me{"caller"};
   const auto            packed = psio::to_pssz(Payload{7, std::vector<char>(size, 't')});
   const psio::pssz_view<Payload> trx{packed};
   const MethodNumber             callback{"onDone"};

   const ActionViewBuilder<Exec>   exec{me, Exec::service};
   const ActionViewBuilder<Runner> runner{me, Runner::service};
   const LazyActionBuilder<Exec>   lazyExec{me, Exec::service};

   // (Compared outside the macros: Catch would print a megabyte.)
   auto check = [&](const char* what, const auto& before, const auto& after,
                    std::size_t buffersBefore)
   {
      auto expected = bytesOf(before.value);
      auto bytes    = bytesOf(after.value);
      std::printf("%s: %zu bytes; two-step: peak %zu bytes in %zu buffers; in place: peak "
                  "%zu bytes in %zu\n",
                  what, bytes.size(), before.peak, before.count, after.peak, after.count);
      INFO(what);
      const bool sameBytes = std::ranges::equal(expected, bytes);
      CHECK(sameBytes);
      CHECK(after.count == 1);
      CHECK(after.peak >= bytes.size());
      CHECK(after.peak < bytes.size() + 1024);
      CHECK(before.count >= buffersBefore);
      CHECK(before.peak >= buffersBefore * size);
   };

   // A call with a large argument: Actor::call
   check(
       "one call", measure([&] { return psio::to_pssz(twoStep<Exec, 1>(me, Exec::service, trx)); }),
       measure([&] { return exec.recv(trx); }), 2);

   // r-transact scheduleSpeculative: x-run::post(execTrx(trx))
   check(
       "a call inside a call",
       measure(
           [&]
           {
              Action inner = twoStep<Exec, 0>(me, Exec::service, trx, true);
              return psio::to_pssz(twoStep<Runner, 0>(me, Runner::service, std::uint8_t{2}, inner,
                                                      1000, callback));
           }),
       measure(
           [&]
           {
              return runner.post(std::uint8_t{2}, lazyExec.execTrx(trx, true), 1000, callback);
           }),
       3);

   // r-transact forwardTransaction: http-server::sendProds(recv(trx))
   check(
       "handing on",
       measure(
           [&]
           {
              Action inner = twoStep<Exec, 1>(me, Exec::service, trx);
              return psio::to_pssz(twoStep<Runner, 1>(me, Runner::service, inner));
           }),
       measure([&] { return runner.sendProds(lazyExec.recv(trx)); }), 3);

   // r-transact sendReply, binary: the body is the packed value
   check(
       "a reply with a packed body",
       measure(
           [&]
           {
              HttpReply reply{.contentType = "application/octet-stream",
                              .body        = psio::to_pssz(trx),
                              .headers     = {{"Vary", "Origin"}}};
              return psio::to_pssz(twoStep<Runner, 2>(me, Runner::service, 0, reply));
           }),
       measure(
           [&]
           {
              auto body = psio::packed(trx);
              return runner.sendReply(
                  0, BasicHttpReply<decltype(body)>{.contentType = "application/octet-stream",
                                                    .body        = std::move(body),
                                                    .headers     = {{"Vary", "Origin"}}});
           }),
       3);

   // r-transact sendReply, JSON: the body is the text of the value (two
   // megabytes of hex here). Two-step: the text, exactly sized, then the
   // reply, the arguments and the action around it.
   const Payload value{7, std::vector<char>(size, 't')};
   check(
       "a reply with a JSON body",
       measure(
           [&]
           {
              HttpReply reply{.contentType = "application/json", .headers = {{"Vary", "Origin"}}};
              psio::to_ijson(value, reply.body, psio::json_sizing::exact);
              return psio::to_pssz(twoStep<Runner, 2>(me, Runner::service, 0, reply));
           }),
       measure(
           [&]
           {
              auto body = psio::ijson_of(value);
              return runner.sendReply(
                  0, BasicHttpReply<decltype(body)>{.contentType = "application/json",
                                                    .body        = std::move(body),
                                                    .headers     = {{"Vary", "Origin"}}});
           }),
       3);

   // An event: the payload inside the arguments of events::event inside the action
   const std::vector<char> data(size, 'e');
   check(
       "an event",
       measure(
           [&]
           {
              return psio::to_pssz(
                  Action{me, AccountNumber{"events"}, MethodNumber{"event"},
                         psio::to_pssz(std::tuple(
                             EventDb::historyEvent, MethodNumber{"stored"},
                             psio::method_args_to_pssz<Events, 0>(me, data)))});
           }),
       measure(
           [&]
           {
              return EventEmitterProxy{me, EventDb::historyEvent}.pack<0, &Events::stored>(me,
                                                                                          data);
           }),
       3);
}
