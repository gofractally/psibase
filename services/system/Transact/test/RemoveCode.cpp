#include "RemoveCode.hpp"

#include <psibase/dispatch.hpp>

using namespace psibase;

void RemoveCode::removeCode(psibase::Checksum256 codeHash,
                            std::uint8_t         vmType,
                            std::uint8_t         vmVersion)
{
   kvRemove(CodeByHashRow::db, codeByHashKey(codeHash, vmType, vmVersion));
}

PSIBASE_DISPATCH(RemoveCode)
