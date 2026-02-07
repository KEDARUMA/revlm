const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    // Prefer workspace node_modules for pnpm resolution.
    // pnpmの解決のため、ワークスペース側のnode_modulesを優先する。
    nodeModulesPaths: [
      path.join(projectRoot, 'node_modules'),
      path.join(workspaceRoot, 'node_modules'),
    ],
    // Resolve package exports (needed for modern RN deps).
    // package.jsonのexports解決を有効化する。
    unstable_enablePackageExports: true,
    // Map crypto and local packages explicitly.
    // cryptoとローカルパッケージの解決を明示する。
    extraNodeModules: {
      ...(getDefaultConfig(projectRoot).resolver?.extraNodeModules || {}),
      crypto: path.join(projectRoot, 'node_modules', 'react-native-quick-crypto'),
      '@kedaruma/revlm-shared': path.join(projectRoot, 'node_modules', '@kedaruma', 'revlm-shared'),
      'fast-base64-decode': path.join(projectRoot, 'src', 'shims', 'fast-base64-decode.js'),
    },
    // Alias to ensure Metro uses the shim (CJS-friendly).
    // CJS互換シムを確実に使うためのエイリアス。
    alias: {
      ...(getDefaultConfig(projectRoot).resolver?.alias || {}),
      'fast-base64-decode': path.join(projectRoot, 'src', 'shims', 'fast-base64-decode.js'),
    },
    resolveRequest: (context, moduleName, platform) => {
      // Force shim resolution for fast-base64-decode.
      // fast-base64-decode はシムを強制解決する。
      if (moduleName === 'fast-base64-decode') {
        return {
          filePath: path.join(projectRoot, 'src', 'shims', 'fast-base64-decode.js'),
          type: 'sourceFile',
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
    disableHierarchicalLookup: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
