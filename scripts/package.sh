#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])' "$project_dir/extension/manifest.json")
package_name="wee-read-web-$version.zip"
package_path="$project_dir/dist/$package_name"

mkdir -p "$project_dir/dist"
rm -f "$package_path"
cd "$project_dir/extension"
zip -q -r "$package_path" manifest.json content.js content.css icons
echo "$package_path"
