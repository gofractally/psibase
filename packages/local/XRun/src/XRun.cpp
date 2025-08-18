#include <psibase/dispatch.hpp>
#include <psibase/serviceEntry.hpp>
#include <services/local/XRun.hpp>
#include <services/system/RTransact.hpp>
#include <services/user/Nop.hpp>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;
using namespace UserService;

namespace
{
   void checkAuth(AccountNumber sender)
   {
      // Temporary check. Permissions should be managed by XSetCode
      // when it exists.
      if (sender != RTransact::service)
         abortMessage(sender.str() + " is not allowed to post async actions");
   }
}  // namespace

std::uint64_t XRun::post(RunMode mode, Action action, MicroSeconds maxTime, MethodNumber callback)
{
   checkAuth(getSender());
   check(action.sender == getSender(), "Wrong sender");
   RunRow row{
       .id           = 0,
       .mode         = mode,
       .maxTime      = maxTime,
       .action       = std::move(action),
       .continuation = {.service = getSender(), .method = callback},
   };
   if (auto prev = kvMax<RunRow>(RunRow::db, runPrefix()))
      row.id = prev->id + 1;
   kvPut(RunRow::db, row.key(), row);
   return row.id;
}

std::uint64_t XRun::verify(Checksum256       transactionHash,
                           psibase::Claim    claim,
                           std::vector<char> proof,
                           MicroSeconds      maxTime,
                           MethodNumber      callback)
{
   checkAuth(getSender());
   VerifyArgs args{transactionHash, std::move(claim), std::move(proof)};
   Action     act{.sender  = AccountNumber{},
                  .service = args.claim.service,
                  .method  = MethodNumber("verifySys"),
                  .rawData = psio::to_frac(args)};

   RunRow row{
       .id           = 0,
       .mode         = RunMode::verify,
       .maxTime      = maxTime,
       .action       = std::move(act),
       .continuation = {.service = getSender(), .method = callback},
   };
   if (auto prev = kvMax<RunRow>(RunRow::db, runPrefix()))
      row.id = prev->id + 1;

   kvPut(RunRow::db, row.key(), row);

   return row.id;
}

void XRun::cancel(std::uint64_t id, MethodNumber callback)
{
   checkAuth(getSender());
   auto key = runKey(id);
   {
      auto row = kvGet<RunRow>(RunRow::db, key);
      check(row && row->continuation.service == getSender(),
            "A service can only cancel its own runs");
   }

   RunRow row{
       .id           = id,
       .mode         = RunMode::rpc,
       .maxTime      = MicroSeconds{0},
       .action       = {.sender = getSender(), .service = Nop::service},
       .continuation = {.service = getSender(), .method = callback},
   };
   kvPut(RunRow::db, key, row);
}

void XRun::finish(std::uint64_t id)
{
   checkAuth(getSender());
   auto key = runKey(id);
   auto row = kvGet<RunRow>(RunRow::db, key);
   check(row && row->continuation.service == getSender(), "A service can only finish its own runs");
   kvRemove(RunRow::db, key);
}

PSIBASE_DISPATCH(XRun)
