#ifndef LEHMER64_H
#define LEHMER64_H


/**
* D. H. Lehmer, Mathematical methods in large-scale computing units.
* Proceedings of a Second Symposium on Large Scale Digital Calculating
* Machinery;
* Annals of the Computation Laboratory, Harvard Univ. 26 (1951), pp. 141-146.
*
* P L'Ecuyer,  Tables of linear congruential generators of different sizes and
* good lattice structure. Mathematics of Computation of the American
* Mathematical
* Society 68.225 (1999): 249-260.
*/
struct lehmer64_rng
{
   lehmer64_rng(uint64_t seed)
   {
      _lehmer64_state =
          (((__uint128_t)splitmix64_stateless(seed, 0)) << 64) + splitmix64_stateless(seed, 1);
   }

   uint64_t next()
   {
      _lehmer64_state *= 0xda942042e4dd58b5ull;
      auto r = _lehmer64_state >> 64;

      _lehmer64_state =
          (((__uint128_t)splitmix64_stateless(r, 0)) << 64) + splitmix64_stateless(r, 1);

      return r;
   }

  private:
   __uint128_t _lehmer64_state;

   // state for splitmix64
   uint64_t splitmix64_x; /* The state can be seeded with any value. */

   // call this one before calling splitmix64
   inline void splitmix64_seed(uint64_t seed) { splitmix64_x = seed; }

   // floor( ( (1+sqrt(5))/2 ) * 2**64 MOD 2**64)
   static const uint64_t golden_gamma = 0x9E3779B97F4A7C15ull;

   // returns random number, modifies seed[0]
   // compared with D. Lemire against
   // http://grepcode.com/file/repository.grepcode.com/java/root/jdk/openjdk/8-b132/java/util/SplittableRandom.java#SplittableRandom.0gamma
   inline uint64_t splitmix64_r(uint64_t* seed)
   {
      uint64_t z = (*seed += golden_gamma);
      // David Stafford's Mix13 for MurmurHash3's 64-bit finalizer
      z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
      z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
      return z ^ (z >> 31);
   }

   // returns random number, modifies splitmix64_x
   inline uint64_t splitmix64(void) { return splitmix64_r(&splitmix64_x); }

   // returns the 32 least significant bits of a call to splitmix64
   // this is a simple (inlined) function call followed by a cast
   inline uint32_t splitmix64_cast32(void) { return (uint32_t)splitmix64(); }

   // returns the value of splitmix64 "offset" steps from seed
   inline uint64_t splitmix64_stateless(uint64_t seed, uint64_t offset)
   {
      seed += offset * golden_gamma;
      return splitmix64_r(&seed);
   }
};

/*
static inline void lehmer64_seed(uint64_t seed)
{
   g_lehmer64_state =
       (((__uint128_t)splitmix64_stateless(seed, 0)) << 64) + splitmix64_stateless(seed, 1);
}

static inline uint64_t lehmer64()
{
   g_lehmer64_state *= UINT64_C(0xda942042e4dd58b5);
   return g_lehmer64_state >> 64;
}
*/

#endif
