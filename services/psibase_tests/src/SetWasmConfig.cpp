#include <services/test/SetWasmConfig.hpp>

#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace TestService;

void SetWasmConfig::setWasmCfg(NativeTableNum table, WasmConfigRow row)
{
   check(getSender() == getReceiver(), "Wrong sender");
   psibase::kvPut(WasmConfigRow::db, row.key(table), row);
}

PSIBASE_DISPATCH(SetWasmConfig)
