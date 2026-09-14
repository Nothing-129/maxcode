#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .build
swiftc -warnings-as-errors -o .build/core-tests MaxCode/Core/*.swift Tests/ShellCoreTests.swift
.build/core-tests
node scripts/test-bootstrap.mjs
swiftc -warnings-as-errors -typecheck MaxCode/Core/*.swift MaxCode/ConnectionStore.swift
# Parsing verifies syntax of the UIKit files without claiming an iOS SDK build.
swiftc -frontend -parse MaxCode/*.swift MaxCode/Core/*.swift
plutil -lint MaxCode.xcodeproj/project.pbxproj MaxCode/Info.plist MaxCode/PrivacyInfo.xcprivacy
