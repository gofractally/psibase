#pragma once

#include <memory>
#include <psidb/database_header.hpp>

namespace psidb
{

   class page_manager;
   struct checkpoint_data;
   // A checkpoint represents a consistent snapshot of the database state
   class checkpoint
   {
     public:
     private:
      checkpoint(std::shared_ptr<checkpoint_data> root) : _root(std::move(root)) {}
      friend class page_manager;
      std::shared_ptr<checkpoint_data> _root;
   };

}  // namespace psidb
