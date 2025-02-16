#pragma once
#ifdef __ARM_ARCH_ISA_A64
// Adapted from: https://github.com/cloudius-systems/osv/blob/master/arch/aarch64/arm-clock.cc
inline uint64_t rdtsc()
{
   //Please note we read CNTVCT cpu system register which provides
   //the accross-system consistent value of the virtual system counter.
   uint64_t cntvct;
   asm volatile("mrs %0, cntvct_el0; " : "=r"(cntvct)::"memory");
   return cntvct;
}

inline uint64_t rdtsc_barrier()
{
   uint64_t cntvct;
   asm volatile("isb; mrs %0, cntvct_el0; isb; " : "=r"(cntvct)::"memory");
   return cntvct;
}
/*

inline uint32_t rdtsc_freq() {
    uint32_t freq_hz;
    asm volatile ("mrs %0, cntfrq_el0; isb; " : "=r"(freq_hz) :: "memory");
    return freq_hz;
}
*/
#else
#include <x86intrin.h>
inline uint64_t rdtsc()
{
   return __rdtsc();
}
#endif
