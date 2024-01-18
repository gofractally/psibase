#include <arbtrie/id_alloc.hpp>

namespace arbtrie {

  id_alloc::id_alloc( std::filesystem::path id_file )
     :_data_dir(id_file),_block_alloc(id_file, id_block_size, 1024 /* 256 GB*/),
      _ids_state_file( id_file.native()+".state", access_mode::read_write )
  {
     if( _ids_state_file.size() == 0 ) {
        TRIEDENT_WARN( "initializing new node_meta index" );
         _ids_state_file.resize(round_to_page(sizeof(id_alloc_state)));
         auto idh = new (_ids_state_file.data()) id_alloc_state();
         for( auto& r : idh->regions ) {
            r.first_free.store(end_of_freelist.loc_div16);
            r.use_count.store(0);
            r.next_alloc.store(0);
         }
         idh->regions[0].next_alloc.store(1);
         idh->clean_shutdown = true;
     }
     _state = reinterpret_cast<id_alloc_state*>( _ids_state_file.data() );
     if( not _state->clean_shutdown ) {
        TRIEDENT_WARN( "checking node_meta index state..." );

        // TODO: this could be multi-threaded for faster startup
        const auto nb = _block_alloc.num_blocks();
        for( int b = 0; b < nb; ++b ) {
           auto start = (temp_meta_type*)_block_alloc.get(b);
           auto nm = start;
           const auto end = nm + id_block_size/sizeof(temp_meta_type);
           while( nm != end ) {
              if( nm->ref() and nm->is_changing() ) {
                 TRIEDENT_WARN( "detected partial write in node, data may be corrupted: ",
                                id_address( id_region( (nm - start) / ids_per_page),
                                            id_index( (b * ids_per_page) + ((nm-start) % ids_per_page) ) ) );
              }
           }
        }
     }
  }


  id_alloc::~id_alloc() {
     if( _state )
       _state->clean_shutdown = 1;
  }





} // namespace arbtrie
