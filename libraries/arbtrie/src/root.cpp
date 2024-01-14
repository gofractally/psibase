
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
         _id.id = 0;
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

   root_data::~root_data()
   {
      if (id and not ancestor)
      {
         auto state = session->_segas.lock();
         auto oref  = state.get(id);

         //    std::cerr << "release root: " << id <<" ref: " <<oref.ref() <<"\n";
         release_node(oref);
      }
   }
   root_data::root_data(read_session* ses, std::shared_ptr<root_data> ancestor, object_id id)
       : session(ses), ancestor(std::move(ancestor)), id(id)
   {
      if constexpr (debug_roots)
         std::cout << id.id << ": root(): ancestor=" << (ancestor ? ancestor->id.id : 0)
                   << std::endl;
      /*
         if( id ) {
            auto state = session->_segas.lock();
            std::cerr <<" RETAIN root.cpp:28   "<<id <<"\n";
            state.get(id).retain();
         }
         */
   }

   void root::set_id(object_id rid)
   {
      assert(_data);
      if (_data->id == rid)
         return;
      if (not _data->id)
      {
         _data->id = rid;
         return;
      }

      if (is_unique())
      {
         _data->id = rid;
      }
      else
      {
         _data = std::make_shared<root_data>(std::ref(_data->session), nullptr, rid);
      }
   }

   bool root::is_unique() const
   {
      assert(_data);
      if (not _data) [[likely]]
         return true;
      if (not _data->id) [[unlikely]]
         return true;
      if (_data->ancestor)
         return false;
      if (_data.use_count() > 1)
         return false;
      if (_data->session->_segas.lock().get(_data->id).ref() > 1)
         return false;
      return true;
   }
}  // namespace arbtrie
