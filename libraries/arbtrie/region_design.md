# Region Design 

Every node has a `node_meta` object that tracks the location of the node,
its reference count, type, and locking information. The `id_address` of the 
`node_meta` object is how one node links to another.

An `id_address` is 5 bytes, the top two are the `region` and the bottom 3
are the index in the region. 

To save space, inner nodes (setlist/full) must allocate all of their branches
within the same region. This region should be different from the region the
inner node itself is allocated in. By doing this the size of inner nodes 
can be reduced by 40% and the cache-locality of the resulting children
`node_meta` objects is improved.

Value nodes do not have any children and are always addressed by their full
5 byte `id_address` aka (region.index). 

Ideally new allocations for a node's branches can occur on the same cacheline
as one of a node's existing branches. By doing this iterating over a node's
branches to retain/release/iterate minimizes cacheline misses. 

## Region Allocation

There are 2^16 regions (65,536) and they are allocated in a round-robbin manner.

Every new binary node and inner node are assigned the "next new region" into which
their children will be allocated. The node itself is in a region its parent assigned
it. Children and grandchildren should never be in the same region.

A the new region is identified by a counter that will automatically wrap. This ensures 
that all regions receive a balanced number of inner nodes (at least initially). This
counter may "skip" a region the second/third time it passes over it if the region has
above average density (caused by a node with many branches or COW forks). 

When an binary/inner node allocate a new binary/inner/value for one of their
branches then they allocate it into 

## Allocation Within Region

### Free List Approach - Small / Constant Time / Cache Unfriendly / Mutex Contention
The space-effecient, cache-unfriendly, solution is to utilize a free-list. The freelist
gives us near-constant time alloc and free; however, does create some contention around
the head of the free list. Given each region has its own free list this contention should 
be minimized. 

### Bitset Approach - 1.7% more data / variable time 

This approach uses 1 bit per `node_meta` to indicate whether it is "free or alloc" and
another 1 bit per cacheline to signal cachelines with at least 4 empty slots.

When a node needs to allocate a new `node_meta` for its branches it provides the allocator with
     1. the last cacheline it allocated on
     2. the ids of its children 
    
Best case is the the last cacheline still has space on it and it can return quickly.
The next case searches the cachelines of the children (this can be done in parallel vis SIMD)

Allocating a new `node_meta` within a region  without reference to an existing ID 
should be on an empty cacheline or a cacheline with as few allocations to it as 
possible. 

Region Page Layout
------------------
64 bytes allocation map, 1 bit per index
448 `node_meta` objects 8 byte each
Total: 4096 bytes

Region Meta Data Layout
------------------
Each region has some meta data that it uses to quickly find reasonably empty cachelines.

1 bit per cacheline is reserved in blocks of 64 bytes which is used to identify any cacheline
with a threhold of emptyness (say 3+). This bit is updated on every alloc/free that transitions
the cacheline above/below the threshold (or maybe every alloc free if branch miss is worse than
                                         relaxed atomic fetch and/or)

Using Count Leading Zero/One search can find the first qualifying cacheline. SIMD can
perform this in 1 or 2 instructions. This allows 8 pages to be scanned at a time implying
a database with 2GB of `node_meta` reserved, assuming everything is well balanced. 2GB of `node_meta`
implies at least 16 GB of "smallest possible nodes".  

Given the smallest possible node is now 64 bytes and the header is 16 bytes, leaving on 48 bytes for
data, promoting a 63 byte value to a separate `binary_nodes` should inline values up to 112 bytes. Inline
values of binary nodes don't require `node_meta` structures. 

Allocation Counts
-----------------
A global count for all alloc/free objects is maintained as well as a per-region count. With this
information, every region can determine if it has above or below average density. When picking a new
region we can skip any region that is too far above average in density.







An allocation has one of two modes:

  1. it wants to be on same cacheline as other allocations (peer branches)
  2. it wants to be as far from others as possible (don't take seats others have soft-reserved)


