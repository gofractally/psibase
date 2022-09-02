// TODO: remove this file

#pragma once

#include <psibase/Service.hpp>

namespace psibase
{
   template <typename DerivedService>
   using Contract = Service<DerivedService>;
}
