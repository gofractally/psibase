
void find( index_node* node, string_view prefix ) {
   auto idx = node->branch_idx[cpre.back()];
   if( idx < 255 ) {
      return find( state.get(node->branches[idx]), prefix.substr(cpre.size()) );
   }
}

void find( full_node* node, string_view prefix ) {
   auto cpre = getcpre( node->prefix(), prefix ); 
   auto nid = node->branches[cpre.back()];
   if( nid ) {
      find( state.get(nid), prefix.substr(cpre.size()) );
   }
}


// get_value()
// get_num_branchse()
// get_prefix()
// get_branch_index()
bool find( node_list* node, string_view prefix ) {
   auto cpre = getcpre( node->prefix(), prefix ); 

   if( cpre.size() == prefix )
      return has_value ? value_id() : nullptr;

   int idx = node->branches().find( cpre.back() );
   if ( idx >= 0 ) {
      find( node->branch_ids()[idx], prefix.substr(cpre.size()) )
   }
}

void find( node_header* node, string_view prefix )
{
   switch( node->type ) {
      case full:  // direct indexing
        return find( (full_node*)node, prefix );
      case list:  // lists the branches and does a string find() 
        return find( (list_node*)node, prefix );
      case index: // uses 256 bytes to map branch to id index
        return find( (list_node*)node, prefix );
      case leaf:  // checks the prefix matches and returns value
        return find( (leaf_node*)node, prefix );
   };
}

void upsert( node_header* node, string_view prefix, string_value value ) {
   switch( node->type ) {
      case full:  // direct indexing, null obj ids for missing
        return find( (full_node*)node, prefix );
      case list:  // lists the branches in sorted order and does a string find() 
        return find( (list_node*)node, prefix );
      case index: // uses 256 bytes to map branch to id index, uses 255 to indicate gaps, cannot rep a full node
        return find( (list_node*)node, prefix );
      case bitset: // uses 256 bits to map branch to id index
        return find( (list_node*)node, prefix );
      case leaf:  // checks the prefix matches and returns value
        return find( (leaf_node*)node, prefix );
   };
}


