/**
 * @format
 */

// Load RN polyfills before anything else, in strict order.
// RN向けポリフィルは必ず順序固定で先に読み込む。
const { Buffer } = require('buffer');
global.Buffer = global.Buffer || Buffer;

require('react-native-get-random-values');

const crypto = require('react-native-quick-crypto');
global.crypto = global.crypto || crypto;

require('fast-text-encoding');
require('@kedaruma/revlm-client/rn-setup');

const { AppRegistry } = require('react-native');
const { name: appName } = require('./app.json');

// Load the app after polyfills are ready.
// ポリフィル準備後にアプリを読み込む。
const App = require('./App').default;

AppRegistry.registerComponent(appName, () => App);
