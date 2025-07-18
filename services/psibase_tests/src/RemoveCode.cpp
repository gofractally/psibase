#include <services/test/RemoveCode.hpp>

#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace TestService;

void RemoveCode::removeCode(psibase::Checksum256 codeHash,
                            std::uint8_t         vmType,
                            std::uint8_t         vmVersion)
{
   kvRemove(CodeByHashRow::db, codeByHashKey(codeHash, vmType, vmVersion));
}

void RemoveCode::setCodeRow(psibase::CodeRow row)
{
   kvPut(CodeRow::db, row.key(), row);
}

PSIBASE_DISPATCH(RemoveCode)
