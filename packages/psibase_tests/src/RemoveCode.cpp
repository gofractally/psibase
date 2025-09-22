#include <services/test/RemoveCode.hpp>

#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace TestService;

void RemoveCode::removeCode(psibase::Checksum256 codeHash,
                            std::uint8_t         vmType,
                            std::uint8_t         vmVersion)
{
   Native::tables(KvMode::write)
       .open<CodeByHashTable>()
       .erase(std::tuple(codeHash, vmType, vmVersion));
}

void RemoveCode::setCodeRow(psibase::CodeRow row)
{
   Native::tables(KvMode::write).open<CodeTable>().put(row);
}

PSIBASE_DISPATCH(RemoveCode)
