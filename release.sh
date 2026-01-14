#!/bin/bash

# Release script: increments version, builds, and packages
# Usage: ./release.sh

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${BLUE}🚀 Starting release process...${NC}\n"

# Function to increment version (e.g., "1.0.3" -> "1.0.4")
increment_version() {
    local version=$1
    IFS='.' read -ra PARTS <<< "$version"
    
    if [ ${#PARTS[@]} -ne 3 ]; then
        echo -e "${RED}❌ Invalid version format: $version${NC}" >&2
        exit 1
    fi
    
    local major=${PARTS[0]}
    local minor=${PARTS[1]}
    local patch=${PARTS[2]}
    
    # Validate numbers
    if ! [[ "$major" =~ ^[0-9]+$ ]] || ! [[ "$minor" =~ ^[0-9]+$ ]] || ! [[ "$patch" =~ ^[0-9]+$ ]]; then
        echo -e "${RED}❌ Invalid version format: $version${NC}" >&2
        exit 1
    fi
    
    # Increment patch version
    local new_patch=$((patch + 1))
    echo "${major}.${minor}.${new_patch}"
}

# Function to update version in JSON file
update_version_in_file() {
    local file_path=$1
    local new_version=$2
    
    if [ ! -f "$file_path" ]; then
        echo -e "${YELLOW}⚠ File not found: $file_path${NC}"
        return
    fi
    
    # Use node or python to update JSON (more reliable than sed)
    if command -v node &> /dev/null; then
        node -e "
            const fs = require('fs');
            const file = '$file_path';
            const json = JSON.parse(fs.readFileSync(file, 'utf-8'));
            if (json.version) {
                const oldVersion = json.version;
                json.version = '$new_version';
                fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf-8');
                console.log('✓ Updated ' + file + ': ' + oldVersion + ' -> ' + '$new_version');
            } else {
                console.log('⚠ No version field found in ' + file);
            }
        "
    elif command -v python3 &> /dev/null; then
        python3 -c "
import json
import sys
file_path = '$file_path'
new_version = '$new_version'
try:
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if 'version' in data:
        old_version = data['version']
        data['version'] = new_version
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write('\n')
        print(f'✓ Updated {file_path}: {old_version} -> {new_version}')
    else:
        print(f'⚠ No version field found in {file_path}')
except Exception as e:
    print(f'Error updating {file_path}: {e}', file=sys.stderr)
    sys.exit(1)
"
    else
        echo -e "${RED}❌ Neither node nor python3 found. Cannot update JSON files.${NC}" >&2
        exit 1
    fi
}

# 1. Read current version from package.json
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ package.json not found${NC}" >&2
    exit 1
fi

CURRENT_VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || \
                 python3 -c "import json; print(json.load(open('package.json'))['version'])" 2>/dev/null)

if [ -z "$CURRENT_VERSION" ]; then
    echo -e "${RED}❌ Could not read version from package.json${NC}" >&2
    exit 1
fi

NEW_VERSION=$(increment_version "$CURRENT_VERSION")
echo -e "${BLUE}📦 Version: ${CURRENT_VERSION} -> ${NEW_VERSION}${NC}\n"

# 2. Update versions in all files
echo -e "${BLUE}📝 Updating versions...${NC}"
update_version_in_file "package.json" "$NEW_VERSION"
update_version_in_file "manifest.json" "$NEW_VERSION"
update_version_in_file "static/manifest.json" "$NEW_VERSION"
echo ""

# 3. Build
echo -e "${BLUE}🔨 Building...${NC}"
if npm run build; then
    echo -e "${GREEN}✓ Build completed${NC}\n"
else
    echo -e "${RED}❌ Build failed${NC}" >&2
    exit 1
fi

# 4. Package
echo -e "${BLUE}📦 Packaging...${NC}"
if npm run package; then
    echo -e "${GREEN}✓ Package completed${NC}\n"
else
    echo -e "${RED}❌ Package failed${NC}" >&2
    exit 1
fi

echo -e "${GREEN}✅ Release ${NEW_VERSION} completed successfully!${NC}"
