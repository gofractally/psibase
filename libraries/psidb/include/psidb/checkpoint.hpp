#pragma once

#include <psidb/database_header.hpp>

namespace psidb
{

   class page_manager;
   // A checkpoint represents a consistent snapshot of the database state
   class checkpoint
   {
     public:
     private:
      checkpoint(checkpoint_root* root) : _root(root) {}
      friend class page_manager;
      checkpoint_root* _root;
   };

}  // namespace psidb
