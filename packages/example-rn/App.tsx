import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type * as RevlmCompat from '@kedaruma/revlm-client/revlm-compat';
import { getEnv } from './src/lib/env';
import { getRevlmClient } from './src/lib/revlmClient';
import type { MoviesCombined } from './src/moviesCombinedTypes';

type AuthErrorKind = 'token_expired' | 'no_refresh_secret' | 'unauthorized' | null;

const PROV_DEMO_AUTH_ID = 'prov-demo-user';
const PROV_DEMO_PASSWORD = 'prov-demo-pass';

type SearchRow = Pick<MoviesCombined, 'year' | 'title' | 'description' | 'cover_photo'>;

type EnvResult =
  | { ok: true; env: ReturnType<typeof getEnv> }
  | { ok: false; error: string };

function loadEnv(): EnvResult {
  try {
    return { ok: true, env: getEnv() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

function getAuthErrorKind(err: unknown): AuthErrorKind {
  const anyErr = err as any;
  if (anyErr?.revlmReason === 'no_refresh_secret') return 'no_refresh_secret';
  const response = anyErr?.response;
  const reason = response?.reason || response?.error;
  if (reason === 'token_expired' || response?.error === 'Token expired') return 'token_expired';
  const message = typeof anyErr?.message === 'string' ? anyErr.message : String(anyErr);
  if (message.includes('Refresh cookie missing')) return 'no_refresh_secret';
  if (message.includes('Token expired')) return 'token_expired';
  if (response?.status === 401 || message.includes('Unauthorized') || message.includes('401')) {
    return 'unauthorized';
  }
  return null;
}

export default function App() {
  const envResult = useMemo(() => loadEnv(), []);

  if (!envResult.ok) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar barStyle="dark-content" />
        <View style={[styles.card, styles.cardDense]}>
          <Text style={styles.title}>Revlm RN Demo</Text>
          <Text style={styles.subtitle}>Missing environment variables.</Text>
          <Text style={styles.errorText}>{envResult.error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const env = envResult.env;
  const revlm = getRevlmClient();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  const [authId, setAuthId] = useState('demo');
  const [password, setPassword] = useState('demo-pass');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [registerAuthId, setRegisterAuthId] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerLoading, setRegisterLoading] = useState(false);

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentAuthId, setCurrentAuthId] = useState<string | null>(null);

  const [demoLogs, setDemoLogs] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [findQuery, setFindQuery] = useState('{ "year": "2024" }');
  const [findOutput, setFindOutput] = useState('');
  const [findError, setFindError] = useState<string | null>(null);
  const [findLoading, setFindLoading] = useState(false);
  const [aggregateQuery, setAggregateQuery] = useState('[{ "$match": { "year": "2024" } }, { "$limit": 5 }]');
  const [aggregateOutput, setAggregateOutput] = useState('');
  const [aggregateError, setAggregateError] = useState<string | null>(null);
  const [aggregateLoading, setAggregateLoading] = useState(false);
  const [mode, setMode] = useState<'demo' | 'search'>('demo');
  const [resultKind, setResultKind] = useState<'none' | 'search' | 'find' | 'aggregate'>('none');

  const demoRunningRef = useRef(false);
  const preLoginProvisionedRef = useRef(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 650,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 650,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  useEffect(() => {
    if (isLoggedIn || preLoginProvisionedRef.current || !env.provisionalLoginEnabled) return;
    preLoginProvisionedRef.current = true;
    const runProvision = async () => {
      setDemoLogs([]);
      addLog('[pre-login] provisionalLogin (auto)');
      try {
        const provisional = await revlm.provisionalLogin(env.provisionalAuthId);
        if (!provisional.ok) {
          throw new Error(provisional.error || provisional.reason || 'provisional login failed');
        }
        addLog('[pre-login] registerUser (auto)');
        const registerRes = await revlm.registerUser(
          { authId: PROV_DEMO_AUTH_ID, userType: 'user', roles: ['user'] },
          PROV_DEMO_PASSWORD
        );
        if (!registerRes.ok) {
          const reason = registerRes.error || registerRes.reason || 'register failed';
          if (reason.includes('authId already exists')) {
            addLog('[pre-login] registerUser skipped (already exists)');
          } else {
            throw new Error(reason);
          }
        } else {
          addLog('[pre-login] registerUser ok');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        addLog(`[error] ${message}`);
      } finally {
        // Clear provisional token to avoid polluting the main session.
        // 仮ログイントークンを破棄して本セッションの汚染を防ぐ。
        revlm.clearToken();
      }
    };
    runProvision();
  }, [env.provisionalAuthId, env.provisionalLoginEnabled, isLoggedIn, revlm]);

  useEffect(() => {
    if (!isLoggedIn || demoRunningRef.current) return;
    demoRunningRef.current = true;
    runGateDemo().finally(() => {
      demoRunningRef.current = false;
    });
  }, [isLoggedIn]);

  const addLog = (line: string) => {
    setDemoLogs((prev) => [...prev, line]);
  };

  const showAuthDialog = (kind: AuthErrorKind) => {
    if (!kind) return;
    const message =
      kind === 'no_refresh_secret'
        ? 'Refresh cookie missing. Please log in again.'
        : kind === 'token_expired'
          ? 'Token expired. Please log in again.'
          : 'Authentication failed. Please log in again.';
    Alert.alert('Session expired', message);
  };

  const handleAuthFailure = async (err: unknown) => {
    const kind = getAuthErrorKind(err);
    if (!kind) return false;
    showAuthDialog(kind);
    setIsLoggedIn(false);
    setCurrentAuthId(null);
    return true;
  };

  const handleLogin = async () => {
    setLoginError(null);
    setLoginLoading(true);
    try {
      const res = await revlm.login(authId, password);
      if (!res.ok) {
        throw new Error(res.error || res.reason || 'login failed');
      }
      setCurrentAuthId(authId);
      setIsLoggedIn(true);
      setMode('demo');
      setResultKind('none');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLoginError(message);
    } finally {
      setLoginLoading(false);
    }
  };

  const openRegister = () => {
    setRegisterError(null);
    setRegisterAuthId('');
    setRegisterPassword('');
    setShowRegister(true);
  };

  const closeRegister = () => {
    setShowRegister(false);
  };

  const handleRegister = async () => {
    setRegisterError(null);
    setRegisterLoading(true);
    try {
      const provisional = await revlm.provisionalLogin(env.provisionalAuthId);
      if (!provisional.ok) {
        throw new Error(provisional.error || provisional.reason || 'provisional login failed');
      }
      const res = await revlm.registerUser(
        { authId: registerAuthId, userType: 'user', roles: ['user'] },
        registerPassword
      );
      if (!res.ok) {
        throw new Error(res.error || res.reason || 'register failed');
      }
      setAuthId(registerAuthId);
      setPassword(registerPassword);
      setShowRegister(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRegisterError(message);
    } finally {
      // Clear provisional token after registration to avoid polluting the main session.
      // 仮ログイントークンを破棄して本セッションの汚染を防ぐ。
      revlm.clearToken();
      setRegisterLoading(false);
    }
  };


  const runGateDemo = async () => {
    if (!isLoggedIn) return;
    setDemoLogs([]);
    setMode('demo');

    try {
      addLog('[1] open collection demo_items');
      type DemoDoc = { _id: unknown; name: string; value: number; note?: string };
      const coll: RevlmCompat.Services.MongoDB.MongoDBCollection<DemoDoc> = revlm
        .db(env.usersDbName)
        .collection<DemoDoc>('demo_items');

      addLog('[2] deleteMany {}');
      await coll.deleteMany({});

      addLog("[3] insertOne { name: 'a', value: 1 }");
      await coll.insertOne({ name: 'a', value: 1 });

      addLog('[4] insertMany { b, c }');
      await coll.insertMany([
        { name: 'b', value: 2 },
        { name: 'c', value: 3 },
      ]);

      addLog('[5] find {} (count)');
      const all = await coll.find({});
      addLog(`    result count = ${all.length}`);

      addLog("[6] findOne { name: 'a' }");
      const one = await coll.findOne({ name: 'a' });
      addLog(`    findOne => ${JSON.stringify(one)}`);

      addLog("[7] findOneAndUpdate { name: 'a' }");
      await coll.findOneAndUpdate({ name: 'a' }, { $set: { value: 10, note: 'updated' } });

      addLog("[8] findOneAndReplace { name: 'a' }");
      await coll.findOneAndReplace({ name: 'a' }, { name: 'a', value: 100, note: 'replaced' } as any);

      addLog("[9] findOneAndDelete { name: 'b' }");
      await coll.findOneAndDelete({ name: 'b' });

      addLog('[10] aggregate sum(value)');
      const agg = await coll.aggregate([{ $group: { _id: null, total: { $sum: '$value' } } }]);
      addLog(`    aggregate => ${JSON.stringify(agg)}`);

      addLog('[11] count {}');
      const count = await coll.count({});
      addLog(`    count => ${count}`);

      addLog('[12] updateOne/updateMany');
      await coll.insertMany([
        { name: 'u1', value: 1 },
        { name: 'u2', value: 1 },
      ]);
      await coll.updateOne({ name: 'u1' }, { $set: { value: 42 } });
      await coll.updateMany({ value: 1 }, { $set: { value: 2 } });

      addLog("[13] deleteOne { name: 'u1' }");
      await coll.deleteOne({ name: 'u1' });

      addLog('[14] deleteMany {} (cleanup)');
      await coll.deleteMany({});

      // Provisional user create/delete moved to pre-login flow.
      // 仮ユーザ作成/削除はログイン前フローに移動。

      addLog('Demo operations completed.');
    } catch (err) {
      if (await handleAuthFailure(err)) return;
      const message = err instanceof Error ? err.message : String(err);
      addLog(`[error] ${message}`);
    }
  };

  const handleSearch = async () => {
    setSearchError(null);
    setSearching(true);
    setSearchResults([]);
    setFindOutput('');
    setAggregateOutput('');
    setResultKind('search');
    setMode('search');
    setDemoLogs([]);

    try {
      const coll: RevlmCompat.Services.MongoDB.MongoDBCollection<MoviesCombined> = revlm
        .db(env.usersDbName)
        .collection<MoviesCombined>('movies_combined');
      const rows = (await coll.aggregate([
        { $match: { $text: { $search: searchQuery } } },
        { $limit: 10 },
        { $project: { year: 1, title: 1, description: 1, cover_photo: 1 } },
      ])) as SearchRow[];
      setSearchResults(
        (rows || []).map((row) => ({
          year: row?.year ?? '',
          title: row?.title ?? '',
          description: row?.description ?? '',
          cover_photo: row?.cover_photo ?? '',
        }))
      );
    } catch (err) {
      if (await handleAuthFailure(err)) return;
      const message = err instanceof Error ? err.message : String(err);
      setSearchError(message);
    } finally {
      setSearching(false);
    }
  };

  const handleFind = async () => {
    setFindError(null);
    setFindOutput('');
    setFindLoading(true);
    setSearchResults([]);
    setAggregateOutput('');
    setDemoLogs([]);
    setMode('search');
    setResultKind('find');

    try {
      const filter = JSON.parse(findQuery || '{}');
      const coll: RevlmCompat.Services.MongoDB.MongoDBCollection<MoviesCombined> = revlm
        .db(env.usersDbName)
        .collection<MoviesCombined>('movies_combined');
      const rows = await coll.find(filter, { limit: 100 });
      setFindOutput(JSON.stringify(rows, null, 2));
    } catch (err) {
      if (await handleAuthFailure(err)) return;
      const message = err instanceof Error ? err.message : String(err);
      setFindError(message);
    } finally {
      setFindLoading(false);
    }
  };

  const handleAggregate = async () => {
    setAggregateError(null);
    setAggregateOutput('');
    setAggregateLoading(true);
    setSearchResults([]);
    setFindOutput('');
    setDemoLogs([]);
    setMode('search');
    setResultKind('aggregate');

    try {
      const pipeline = JSON.parse(aggregateQuery || '[]');
      if (!Array.isArray(pipeline)) {
        throw new Error('aggregate pipeline must be a JSON array');
      }
      const coll: RevlmCompat.Services.MongoDB.MongoDBCollection<MoviesCombined> = revlm
        .db(env.usersDbName)
        .collection<MoviesCombined>('movies_combined');
      const rows = await coll.aggregate(pipeline);
      setAggregateOutput(JSON.stringify(rows, null, 2));
    } catch (err) {
      if (await handleAuthFailure(err)) return;
      const message = err instanceof Error ? err.message : String(err);
      setAggregateError(message);
    } finally {
      setAggregateLoading(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar barStyle="dark-content" />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.backgroundLayer}>
              <View style={[styles.orb, styles.orbPrimary]} />
              <View style={[styles.orb, styles.orbSecondary]} />
            </View>

            <Animated.View style={[styles.card, styles.heroCard, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
              <Text style={styles.title}>Revlm RN Demo Login</Text>
              <Text style={styles.subtitle}>
                Sign in with the demo account to open the demonstration page.
              </Text>
            </Animated.View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Login</Text>
              <Text style={styles.label}>Auth ID</Text>
              <TextInput
                style={styles.input}
                value={authId}
                onChangeText={setAuthId}
                placeholder="demo"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
              />
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="demo-pass"
                placeholderTextColor={colors.muted}
                secureTextEntry
              />

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.button, loginLoading && styles.buttonDisabled]}
                  onPress={handleLogin}
                  disabled={loginLoading}
                >
                  <Text style={styles.buttonText}>{loginLoading ? 'Logging in...' : 'Login'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.buttonGhost,
                    !env.provisionalLoginEnabled && styles.buttonDisabled,
                  ]}
                  onPress={openRegister}
                  disabled={!env.provisionalLoginEnabled}
                >
                  <Text style={styles.buttonGhostText}>Create account</Text>
                </TouchableOpacity>
              </View>
              {loginError ? <Text style={styles.errorText}>{loginError}</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Environment</Text>
              <Text style={styles.noticeText}>
                This demo reads settings from <Text style={styles.codeText}>.env</Text> in
                <Text style={styles.codeText}> packages/example-rn</Text>.
              </Text>
              <View style={styles.envList}>
                <Text style={styles.envItem}>Base URL: {env.baseUrl}</Text>
                <Text style={styles.envItem}>Users DB: {env.usersDbName}</Text>
                <Text style={styles.envItem}>Session ID: {env.sessionId}</Text>
                <Text style={styles.envItem}>Provisional enabled: {String(env.provisionalLoginEnabled)}</Text>
                <Text style={styles.envItem}>Auth domain: {env.provisionalAuthDomain}</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Demo operations (provisional)</Text>
              <View style={styles.logBox}>
                {demoLogs.length === 0 ? (
                  <Text style={styles.noticeText}>Waiting for provisional flow...</Text>
                ) : (
                  demoLogs.map((line, idx) => (
                    <Text key={`${line}-${idx}`} style={styles.logText}>
                      {line}
                    </Text>
                  ))
                )}
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        <Modal visible={showRegister} transparent animationType="slide" onRequestClose={closeRegister}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.sectionTitle}>Create account</Text>
              <Text style={styles.noticeText}>Register a new user via provisional login.</Text>

              <Text style={styles.label}>Auth ID</Text>
              <TextInput
                style={styles.input}
                value={registerAuthId}
                onChangeText={setRegisterAuthId}
                placeholder="new-user"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
              />
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                value={registerPassword}
                onChangeText={setRegisterPassword}
                placeholder="new-pass"
                placeholderTextColor={colors.muted}
                secureTextEntry
              />

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.button, registerLoading && styles.buttonDisabled]}
                  onPress={handleRegister}
                  disabled={registerLoading}
                >
                  <Text style={styles.buttonText}>{registerLoading ? 'Registering...' : 'Register'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, styles.buttonGhost]} onPress={closeRegister}>
                  <Text style={styles.buttonGhostText}>Close</Text>
                </TouchableOpacity>
              </View>

              {registerError ? <Text style={styles.errorText}>{registerError}</Text> : null}
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.backgroundLayer}>
            <View style={[styles.orb, styles.orbPrimary]} />
            <View style={[styles.orb, styles.orbSecondary]} />
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Revlm RN Demo</Text>
            <Text style={styles.subtitle}>Gate operations first, then search the movies dataset.</Text>
            {currentAuthId ? <Text style={styles.badgeText}>Signed in as {currentAuthId}</Text> : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Search</Text>
            <Text style={styles.label}>Search movies_combined</Text>
            <TextInput
              style={styles.input}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Type keywords and press Run search"
              placeholderTextColor={colors.muted}
            />
            <TouchableOpacity
              style={[styles.button, searching && styles.buttonDisabled]}
              onPress={handleSearch}
              disabled={searching}
            >
              <Text style={styles.buttonText}>{searching ? 'Searching...' : 'Run search'}</Text>
            </TouchableOpacity>
            {searchError ? <Text style={styles.errorText}>{searchError}</Text> : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Find / Aggregate</Text>
            <Text style={styles.noticeText}>Run raw queries against movies_combined.</Text>

            <Text style={styles.label}>Find filter (JSON)</Text>
            <TextInput
              style={styles.input}
              value={findQuery}
              onChangeText={setFindQuery}
              placeholder='{"year": "2024"}'
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={[styles.button, findLoading && styles.buttonDisabled]}
              onPress={handleFind}
              disabled={findLoading}
            >
              <Text style={styles.buttonText}>{findLoading ? 'Running...' : 'Run find'}</Text>
            </TouchableOpacity>
            {findError ? <Text style={styles.errorText}>{findError}</Text> : null}

            <Text style={[styles.label, styles.spacedLabel]}>Aggregate pipeline (JSON array)</Text>
            <TextInput
              style={styles.input}
              value={aggregateQuery}
              onChangeText={setAggregateQuery}
              placeholder='[{ "$match": { "year": "2024" } }]'
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={[styles.button, aggregateLoading && styles.buttonDisabled]}
              onPress={handleAggregate}
              disabled={aggregateLoading}
            >
              <Text style={styles.buttonText}>{aggregateLoading ? 'Running...' : 'Run aggregate'}</Text>
            </TouchableOpacity>
            {aggregateError ? <Text style={styles.errorText}>{aggregateError}</Text> : null}
          </View>

          {mode === 'demo' ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Demo operations (gate)</Text>
              <View style={styles.logBox}>
                {demoLogs.length === 0 ? (
                  <Text style={styles.noticeText}>Running demo operations...</Text>
                ) : (
                  demoLogs.map((line, idx) => (
                    <Text key={`${line}-${idx}`} style={styles.logText}>
                      {line}
                    </Text>
                  ))
                )}
              </View>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Search results</Text>
              {resultKind === 'find' && findOutput ? (
                <Text style={styles.codeBlock}>{findOutput}</Text>
              ) : null}
              {resultKind === 'aggregate' && aggregateOutput ? (
                <Text style={styles.codeBlock}>{aggregateOutput}</Text>
              ) : null}
              {resultKind === 'search' && searchResults.length === 0 ? (
                <Text style={styles.noticeText}>No results.</Text>
              ) : null}
              {resultKind === 'search'
                ? searchResults.map((row, idx) => (
                    <View key={`${row.title}-${idx}`} style={styles.resultRow}>
                      <View style={styles.thumbCell}>
                        {row.cover_photo ? (
                          <Image source={{ uri: row.cover_photo }} style={styles.thumb} />
                        ) : (
                          <View style={styles.thumbPlaceholder} />
                        )}
                      </View>
                      <View style={styles.resultBody}>
                        <Text style={styles.resultTitle}>
                          {row.title || ''} ({row.year || '?'})
                        </Text>
                        <Text style={styles.resultDescription}>{row.description}</Text>
                      </View>
                    </View>
                  ))
                : null}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const colors = {
  background: '#f7efe7',
  card: '#fff5ee',
  cardEdge: '#f2c7a7',
  ink: '#202124',
  muted: '#6c6f77',
  accent: '#ea6f2e',
  accentDark: '#c4561d',
  accentSoft: '#ffe1cf',
  highlight: '#ffd6bf',
  shadow: 'rgba(140, 76, 37, 0.12)',
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  orb: {
    position: 'absolute',
    borderRadius: 200,
    opacity: 0.4,
  },
  orbPrimary: {
    width: 260,
    height: 260,
    backgroundColor: colors.highlight,
    top: -40,
    right: -80,
  },
  orbSecondary: {
    width: 220,
    height: 220,
    backgroundColor: '#f5b692',
    bottom: -50,
    left: -70,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.cardEdge,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 3,
  },
  cardDense: {
    padding: 16,
  },
  heroCard: {
    backgroundColor: '#fff0e6',
  },
  title: {
    fontSize: 26,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    color: colors.ink,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: colors.muted,
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: 10,
  },
  label: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 6,
  },
  spacedLabel: {
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.cardEdge,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: '#fffaf7',
    marginBottom: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  button: {
    backgroundColor: colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 4,
    marginRight: 12,
    marginBottom: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  buttonGhost: {
    backgroundColor: colors.accentSoft,
  },
  buttonGhostText: {
    color: colors.accentDark,
    fontWeight: '600',
  },
  noticeText: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
    marginBottom: 10,
  },
  errorText: {
    color: '#b93826',
    marginTop: 6,
  },
  envList: {
    marginTop: 6,
  },
  envItem: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 4,
  },
  codeText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    color: colors.accentDark,
  },
  logBox: {
    backgroundColor: '#fffaf7',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.cardEdge,
  },
  logText: {
    fontSize: 12,
    color: colors.ink,
    marginBottom: 4,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  codeBlock: {
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    color: colors.ink,
    backgroundColor: '#fffaf7',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardEdge,
  },
  resultRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  thumbCell: {
    width: 74,
    height: 94,
    borderRadius: 10,
    backgroundColor: '#f2d1bd',
    overflow: 'hidden',
    marginRight: 12,
  },
  thumb: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  thumbPlaceholder: {
    flex: 1,
    backgroundColor: '#f2d1bd',
  },
  resultBody: {
    flex: 1,
  },
  resultTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: 4,
  },
  resultDescription: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 16,
  },
  badgeText: {
    marginTop: 8,
    fontSize: 12,
    color: colors.accentDark,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(26, 20, 14, 0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.cardEdge,
  },
});
