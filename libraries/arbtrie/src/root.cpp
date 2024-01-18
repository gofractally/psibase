
#include <arbtrie/database.hpp>
#include <arbtrie/root.hpp>

namespace arbtrie
{
   int node_handle::ref() const
   {
      if (_id)
      {
         auto state = _session->_segas.lock();
         auto oref  = state.get(_id);
         return oref.ref();
      }
      return 0;
   }
   void node_handle::release()
   {
      if (_id)
      {
         auto state = _session->_segas.lock();
         //              std::cerr<< "release id: " << oref.id() <<"  init ref: " << oref.ref() <<"\n";
         release_node(state.get(_id));
         _id.reset();
      }
   }
   void node_handle::retain()
   {
      if (_id)
      {
         auto state = _session->_segas.lock();
         auto oref  = state.get(_id);
         //             std::cerr<< "retain id: " << oref.id() <<"  init ref: " << oref.ref() <<"\n";
         if (not state.get(_id).retain())
         {
            throw std::runtime_error("unable to retain object id");
         }
      }
   }


}  // namespace arbtrie
