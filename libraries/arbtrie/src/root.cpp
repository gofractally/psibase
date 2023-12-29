
#include <arbtrie/root.hpp>
#include <arbtrie/database.hpp>

namespace arbtrie
{
   root_data::~root_data()
   {
      if (id and not ancestor)
         session->release(id); 
   }

   void root::set_id(object_id rid)
   {
      if (_data->id == rid)
         return;
      if (not _data->id)
         _data->id = rid;
      else if (is_unique())
      {
         _data->session->release(_data->id);
         _data->id = rid;
      }
      else
      {
         _data = std::make_shared<root_data>(std::ref(_data->session), nullptr, _data->id);
      }
   }
}  // namespace arbtrie
