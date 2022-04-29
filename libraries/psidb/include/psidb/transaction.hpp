#pragma once

#include <psidb/cursor.hpp>
#include <psidb/page_manager.hpp>

namespace psidb
{

   class transaction
   {
     public:
      transaction(page_manager* db, const checkpoint& ck) : _db(db), _checkpoint(ck) {}
      cursor get_cursor() { return {_db, _checkpoint}; }
      void   commit() { _db->commit_transaction(_checkpoint); }

     private:
      page_manager* _db;
      checkpoint    _checkpoint;
   };

}  // namespace psidb
