#!/bin/sh
# Creates backend/sandbox/.venv with the Chalk SDK. Needs uv and a logged-in Chalk CLI (chalk login).
set -e
cd "$(dirname "$0")/../sandbox"
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
echo "Chalk helper ready: $(pwd)/.venv/bin/python"
