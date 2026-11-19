#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])' "$project_dir/extension/manifest.json")
release_dir="$project_dir/dist/$version"
package_name="wee-read-web-$version.zip"
package_path="$release_dir/$package_name"

mkdir -p "$release_dir"
rm -f "$package_path"
cd "$project_dir/extension"
zip -q -r "$package_path" manifest.json background.js content.js content.css icons
cp "$project_dir/README.md" "$project_dir/AGENTS.md" "$project_dir/store/LISTING.md" "$release_dir/"
echo "$package_path"
