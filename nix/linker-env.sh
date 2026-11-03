# Strip host /usr lib dirs from Nix linker env.
# Cursor (buildFHSEnv) and similar wrappers prepend -L/usr/lib to NIX_*FLAGS;
# that makes -lrt resolve to /usr/lib and the ld-wrapper bake /usr/lib into
# RUNPATH, so psitest/psinode then mix host librt with Nix libc (GLIBC_PRIVATE).

__psibase_filter_usr_Lflags() {
  local out="" f
  for f in $1; do
    case "$f" in
      -L/usr/lib|-L/usr/lib/*|-L/usr/lib32|-L/usr/lib32/*|-L/usr/lib64|-L/usr/lib64/*) continue ;;
    esac
    out="${out:+$out }$f"
  done
  printf '%s' "$out"
}

__psibase_filter_usr_path() {
  local out="" p IFS=':'
  for p in $1; do
    case "$p" in
      /usr/lib|/usr/lib/*|/usr/lib32|/usr/lib32/*|/usr/lib64|/usr/lib64/*) continue ;;
    esac
    [ -n "$p" ] || continue
    out="${out:+$out:}$p"
  done
  printf '%s' "$out"
}

NIX_CFLAGS_LINK="$(__psibase_filter_usr_Lflags "${NIX_CFLAGS_LINK:-}")"
NIX_LDFLAGS="$(__psibase_filter_usr_Lflags "${NIX_LDFLAGS:-}")"
NIX_LDFLAGS_BEFORE="$(__psibase_filter_usr_Lflags "${NIX_LDFLAGS_BEFORE:-}")"
export NIX_CFLAGS_LINK NIX_LDFLAGS NIX_LDFLAGS_BEFORE

LIBRARY_PATH="$(__psibase_filter_usr_path "${LIBRARY_PATH:-}")"
LD_LIBRARY_PATH="$(__psibase_filter_usr_path "${LD_LIBRARY_PATH:-}")"
export LIBRARY_PATH LD_LIBRARY_PATH

if [ -n "${NIX_CC:-}" ] && [ -f "${NIX_CC}/nix-support/orig-libc" ]; then
  _psibase_nix_libc="$(cat "${NIX_CC}/nix-support/orig-libc")/lib"
  case " ${NIX_LDFLAGS} " in
    *" -L${_psibase_nix_libc} "*) ;;
    *) export NIX_LDFLAGS="-L${_psibase_nix_libc}${NIX_LDFLAGS:+ $NIX_LDFLAGS}" ;;
  esac
  case ":${LIBRARY_PATH:-}:" in
    *":${_psibase_nix_libc}:"*) ;;
    *) export LIBRARY_PATH="${_psibase_nix_libc}${LIBRARY_PATH:+:$LIBRARY_PATH}" ;;
  esac
  unset _psibase_nix_libc
fi

unset -f __psibase_filter_usr_Lflags __psibase_filter_usr_path
