#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>

namespace LocalService
{
   // The XRun service manages asynchronous execution
   struct XRun : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-run"};
      // Schedules an action for execution and returns the run id. The sender
      // of the action must be the sender of post. The callback will be passed
      // the run id and a TransactionTrace and MUST call finish.
      //
      // The action SHOULD be idempotent, as it may be run more than once.
      std::uint64_t post(psibase::RunMode      mode,
                         psibase::Action       action,
                         psibase::MicroSeconds maxTime,
                         psibase::MethodNumber callback);
      // Schedules a verify action for execution and returns the run id. The
      // callback will be passed the run id and a TransactionTrace and MUST
      // call finish.
      std::uint64_t verify(psibase::Checksum256  transactionHash,
                           psibase::Claim        claim,
                           std::vector<char>     proof,
                           psibase::MicroSeconds maxTime,
                           psibase::MethodNumber callback);
      // Cancels a pending execution. Cancellation is asynchronous
      // and may have no effect if the execution has already started.
      // After a call to cancel, any of the following combinations are possible:
      // - original action, original callback
      // - original action, cancel callback
      // - nop, cancel callback
      void cancel(std::uint64_t id, psibase::MethodNumber callback);
      // This MUST called by the callback, and MUST NOT be called by anthing else.
      void finish(std::uint64_t id);
   };
   PSIO_REFLECT(XRun,
                method(post, mode, action, maxTime, callback),
                method(verify, transactionHash, claim, proof, maxTime, callback),
                method(cancel, id, callback),
                method(finish, id))
}  // namespace LocalService
