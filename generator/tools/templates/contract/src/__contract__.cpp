#include <psibase/dispatch.hpp>
#include "../include/services/user/__contract__.hpp"
#include <psibase/serveGraphQL.hpp>
#include <psibase/servePackAction.hpp>
#include <psibase/check.hpp>

using namespace __contract__;
using namespace psibase;
using namespace std;


struct CounterQuery
{
   auto counter() const
   {
      return Tables{getReceiver()}.open<CounterTable>().getIndex<0>();
   }

};

PSIO_REFLECT(CounterQuery, method(counter))

void __contract__Service::increment(uint32_t num)
{
   check(num > 100, "must be greater than 100");
   auto table = Tables{getReceiver()}.open<CounterTable>();

   auto idx = table.getIndex<0>();
   CounterRow counterRow = idx.get(getSender()).value_or<CounterRow>({
         .account = getSender(),
         .counter = 0
   });

   counterRow.counter += num;
   table.put(counterRow);
}

optional<HttpReply> __contract__Service::serveSys(HttpRequest request)
{

   if (auto result = servePackAction<__contract__Service>(request))
      return result;

   if (auto result = serveContent(request, Tables{getReceiver()}))
      return result;

   if (auto result = serveGraphQL(request, CounterQuery{}))
      return result;

   return nullopt;
}

void __contract__Service::storeSys(string path, string contentType, vector<char> content)
{
   check(getSender() == getReceiver(), "wrong sender");
   storeContent(move(path), move(contentType), move(content), Tables{getReceiver()});
}


PSIBASE_DISPATCH(__contract__::__contract__Service)