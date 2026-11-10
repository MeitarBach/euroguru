#!/bin/sh
# Runs a script in the research venv. LightGBM needs an OpenMP runtime; torch ships one.
cd "$(dirname "$0")"
export DYLD_LIBRARY_PATH="$PWD/venv/lib/python3.14/site-packages/torch/lib" KMP_DUPLICATE_LIB_OK=TRUE
exec venv/bin/python "$@"
