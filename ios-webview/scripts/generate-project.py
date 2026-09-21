#!/usr/bin/env python3
"""Generate the checked-in Xcode project using only Python's standard library."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
objects = {}


def identifier(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()


def add(object_name, isa, **fields):
    key = identifier(object_name)
    objects[key] = dict(isa=isa, **fields)
    return key


def encode(value, depth=0):
    if isinstance(value, dict):
        indent = "\t" * depth
        entries = "\n".join(f"{indent}\t{key} = {encode(item, depth + 1)};" for key, item in value.items())
        return "{\n" + entries + "\n" + indent + "}"
    if isinstance(value, list):
        return "(" + ", ".join(encode(item, depth) for item in value) + ")"
    return json.dumps(str(value), ensure_ascii=False)


source_refs = []
source_builds = []
for path in sorted((ROOT / "MaxCode").rglob("*.swift")):
    relative = path.relative_to(ROOT).as_posix()
    ref = add(relative, "PBXFileReference", lastKnownFileType="sourcecode.swift", path=relative, sourceTree="SOURCE_ROOT")
    source_refs.append(ref)
    source_builds.append(add(relative + ":build", "PBXBuildFile", fileRef=ref))

assets = add("assets", "PBXFileReference", lastKnownFileType="folder.assetcatalog", path="MaxCode/Assets.xcassets", sourceTree="SOURCE_ROOT")
plist = add("plist", "PBXFileReference", lastKnownFileType="text.plist.xml", path="MaxCode/Info.plist", sourceTree="SOURCE_ROOT")
privacy = add("privacy", "PBXFileReference", lastKnownFileType="text.xml", path="MaxCode/PrivacyInfo.xcprivacy", sourceTree="SOURCE_ROOT")
signing = add("signing", "PBXFileReference", lastKnownFileType="text.xcconfig", path="Signing.xcconfig", sourceTree="SOURCE_ROOT")
product = add("product", "PBXFileReference", explicitFileType="wrapper.application", path="MaxCode.app", sourceTree="BUILT_PRODUCTS_DIR")
products = add("products", "PBXGroup", children=[product], name="Products", sourceTree="<group>")
group = add("root", "PBXGroup", children=source_refs + [assets, plist, privacy, signing, products], sourceTree="<group>")
sources = add("sources", "PBXSourcesBuildPhase", buildActionMask=2147483647, files=source_builds, runOnlyForDeploymentPostprocessing=0)
resources = add("resources", "PBXResourcesBuildPhase", buildActionMask=2147483647, files=[
    add("assets:build", "PBXBuildFile", fileRef=assets),
    add("privacy:build", "PBXBuildFile", fileRef=privacy)
], runOnlyForDeploymentPostprocessing=0)
frameworks = add("frameworks", "PBXFrameworksBuildPhase", buildActionMask=2147483647, files=[], runOnlyForDeploymentPostprocessing=0)

project_configs = []
app_configs = []
for configuration in ["Debug", "Release"]:
    debug = configuration == "Debug"
    project_configs.append(add("project:" + configuration, "XCBuildConfiguration", name=configuration, buildSettings={
        "CLANG_ENABLE_MODULES": "YES", "CLANG_ENABLE_OBJC_ARC": "YES",
        "IPHONEOS_DEPLOYMENT_TARGET": "16.0", "SDKROOT": "iphoneos",
        "SWIFT_VERSION": "5.0", "SWIFT_OPTIMIZATION_LEVEL": "-Onone" if debug else "-O",
        "DEBUG_INFORMATION_FORMAT": "dwarf" if debug else "dwarf-with-dsym",
        "ENABLE_TESTABILITY": "YES" if debug else "NO",
        "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "DEBUG" if debug else "",
        "SWIFT_COMPILATION_MODE": "singlefile" if debug else "wholemodule"
    }))
    app_configs.append(add("app:" + configuration, "XCBuildConfiguration", name=configuration, baseConfigurationReference=signing, buildSettings={
        "PRODUCT_NAME": "MaxCode",
        "TARGETED_DEVICE_FAMILY": "1,2", "SUPPORTED_PLATFORMS": "iphoneos iphonesimulator",
        "SUPPORTS_MACCATALYST": "NO",
        "INFOPLIST_FILE": "MaxCode/Info.plist", "GENERATE_INFOPLIST_FILE": "NO",
        "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon", "CURRENT_PROJECT_VERSION": "3",
        "MARKETING_VERSION": "0.1.0", "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/Frameworks"]
    }))

project_list = add("project:configs", "XCConfigurationList", buildConfigurations=project_configs, defaultConfigurationIsVisible=0, defaultConfigurationName="Release")
app_list = add("app:configs", "XCConfigurationList", buildConfigurations=app_configs, defaultConfigurationIsVisible=0, defaultConfigurationName="Release")
target = add("app", "PBXNativeTarget", name="MaxCode", productName="MaxCode", productType="com.apple.product-type.application", productReference=product,
             buildConfigurationList=app_list, buildPhases=[sources, frameworks, resources], buildRules=[], dependencies=[])
project = add("project", "PBXProject", attributes={"LastUpgradeCheck": "1600", "TargetAttributes": {target: {"CreatedOnToolsVersion": "16.0"}}},
              buildConfigurationList=project_list, compatibilityVersion="Xcode 14.0", developmentRegion="zh-Hans", knownRegions=["zh-Hans", "en", "Base"],
              mainGroup=group, productRefGroup=products, projectDirPath="", projectRoot="", targets=[target])
output = ROOT / "MaxCode.xcodeproj"
output.mkdir(exist_ok=True)
(output / "project.pbxproj").write_text("// !$*UTF8*$!\n" + encode({
    "archiveVersion": 1, "classes": {}, "objectVersion": 56, "objects": objects, "rootObject": project
}) + "\n")
scheme_dir = output / "xcshareddata/xcschemes"
scheme_dir.mkdir(parents=True, exist_ok=True)
reference = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="MaxCode.app" BlueprintName="MaxCode" ReferencedContainer="container:MaxCode.xcodeproj"/>'
(scheme_dir / "MaxCode.xcscheme").write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES">
    <BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{reference}</BuildActionEntry></BuildActionEntries>
  </BuildAction>
  <TestAction buildConfiguration="Debug" shouldUseLaunchSchemeArgsEnv="YES"><Testables/></TestAction>
  <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></LaunchAction>
  <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></ProfileAction>
  <AnalyzeAction buildConfiguration="Debug"/>
  <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
''')
print(output)
