#include <services/local/XTimer.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>

using namespace psibase;
using namespace LocalService;

std::uint64_t XTimer::runAt(MonotonicTimePointUSec time, MethodNumber callback)
{
   auto          timer   = Native::session().open<TimerTable>();
   auto          table   = open<TimerQueueTable>();
   auto          idTable = open<TimerIdTable>();
   std::uint64_t id;
   PSIBASE_SUBJECTIVE_TX
   {
      auto current = timer.get({});
      if (!current || current->expiration > time)
      {
         timer.put(
             {.expiration = time, .service = XTimer::service, .method = MethodNumber{"runOne"}});
      }
      auto idRow = idTable.get({}).value_or(TimerIdRow{});
      id         = idRow.next++;
      idTable.put(idRow);
      table.put({.id = id, .expiration = time, .service = getSender(), .method = callback});
   }
   return id;
}

bool XTimer::cancel(std::uint64_t id)
{
   auto timer  = Native::session().open<TimerTable>();
   auto table  = open<TimerQueueTable>();
   bool result = false;
   PSIBASE_SUBJECTIVE_TX
   {
      if (auto row = table.get(id))
      {
         check(row->service == getSender(), "Wrong sender");
         table.remove(*row);

         if (auto next = table.getIndex<1>().first())
         {
            timer.put({.expiration = next->expiration,
                       .service    = XTimer::service,
                       .method     = MethodNumber{"runOne"}});
         }
         else
         {
            timer.erase(std::tuple());
         }
      }
   }
   return result;
}

void XTimer::runOne()
{
   check(getSender() == psibase::AccountNumber{}, "runOne should be called by the host");
   auto                         timer = Native::session().open<TimerTable>();
   auto                         table = open<TimerQueueTable>();
   std::optional<TimerQueueRow> row;
   auto now = std::chrono::time_point_cast<MicroSeconds>(std::chrono::steady_clock::now());
   PSIBASE_SUBJECTIVE_TX
   {
      row = table.getIndex<1>().first();
      if (row)
      {
         if (row->expiration <= now)
         {
            table.remove(*row);
            if (auto next = table.getIndex<1>().first())
            {
               timer.put({.expiration = next->expiration,
                          .service    = XTimer::service,
                          .method     = MethodNumber{"runOne"}});
            }
            else
            {
               timer.erase(std::tuple());
            }
         }
         else
         {
            row.reset();
         }
      }
   }
   if (row)
      call(Action{.sender  = XTimer::service,
                  .service = row->service,
                  .method  = row->method,
                  .rawData = psio::convert_to_frac(std::tuple(row->id))});
}

PSIBASE_DISPATCH(XTimer)
