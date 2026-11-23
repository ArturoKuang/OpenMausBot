// Expo SDK 58 Metro. The protocol package lives outside this app; it is read straight from source, and every
// dependency (its zod and croner included) resolves from this app's own node_modules, never the pnpm root's.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const protocolRoot = path.resolve(__dirname, "../../packages/phone-protocol");
const config = getDefaultConfig(__dirname);

config.watchFolders = [protocolRoot];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = { "@openmausbot/phone-protocol": protocolRoot };

module.exports = config;
