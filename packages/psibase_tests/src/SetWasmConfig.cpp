#include <services/test/SetWasmConfig.hpp>

#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace TestService;

void SetWasmConfig::setWasmCfg(NativeTableNum table, WasmConfigRow row)
{
   check(getSender() == getReceiver(), "Wrong sender");
   auto native = Native::tables(KvMode::write);
   if (table == transactionWasmConfigTable)
      native.open<transactionWasmConfigTable>().put(row);
   else if (table == proofWasmConfigTable)
      native.open<proofWasmConfigTable>().put(row);
   else
      abortMessage("Not a wasm config table");
}

PSIBASE_DISPATCH(SetWasmConfig)
