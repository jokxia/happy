import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hasCopilotCli = spawnSync('copilot', ['--version'], { stdio: 'ignore' }).status === 0;
const runRealCopilotTest = process.env.HAPPY_RUN_REAL_COPILOT_TEST === '1';

const mocks = vi.hoisted(() => {
  const sessionHandlers = new Map<string, (params: any) => Promise<any> | any>();
  let userMessageHandler: ((message: any) => void) | null = null;
  let killHandler: (() => Promise<void>) | null = null;

  const mockSession = {
    onUserMessage: vi.fn((handler: (message: any) => void) => {
      userMessageHandler = handler;
    }),
    keepAlive: vi.fn(),
    sendSessionProtocolMessage: vi.fn(),
    sendSessionEvent: vi.fn(),
    updateMetadata: vi.fn(),
    sendSessionDeath: vi.fn(),
    flush: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    updateAgentState: vi.fn((handler: (state: Record<string, unknown>) => Record<string, unknown>) => {
      handler({});
    }),
    rpcHandlerManager: {
      registerHandler: vi.fn((name: string, handler: (params: any) => Promise<any> | any) => {
        sessionHandlers.set(name, handler);
      }),
    },
  };

  return {
    mockAuthAndSetupMachineIfNeeded: vi.fn(async () => ({
      credentials: {
        token: 'token',
        encryption: { type: 'legacy', secret: new Uint8Array(32) },
      },
    })),
    mockIsDaemonRunningCurrentlyInstalledHappyVersion: vi.fn(async () => true),
    mockSpawnHappyCLI: vi.fn(),
    mockLoggerDebug: vi.fn(),
    mockReadSettings: vi.fn(async () => ({ machineId: 'machine-1', sandboxConfig: undefined })),
    mockReadCredentials: vi.fn(async () => null),
    mockApiCreate: vi.fn(),
    mockGetOrCreateMachine: vi.fn(async () => ({})),
    mockGetOrCreateSession: vi.fn(async () => ({ id: 'session-real-1' })),
    mockSetupOfflineReconnection: vi.fn(),
    mockNotifyDaemonSessionStarted: vi.fn(async () => ({ error: null })),
    mockStartHappyServer: vi.fn(),
    mockProjectPath: vi.fn(() => '/tmp/happy'),
    mockSetBackend: vi.fn(),
    mockKillRegister: vi.fn((_rpc: unknown, handler: () => Promise<void>) => {
      killHandler = handler;
    }),
    sessionHandlers,
    getUserMessageHandler: () => userMessageHandler,
    setUserMessageHandler: (handler: ((message: any) => void) | null) => {
      userMessageHandler = handler;
    },
    getKillHandler: () => killHandler,
    setKillHandler: (handler: (() => Promise<void>) | null) => {
      killHandler = handler;
    },
    mockSession,
  };
});

const controlClientModule = {
  checkIfDaemonRunningAndCleanupStaleState: vi.fn(async () => true),
  isDaemonRunningCurrentlyInstalledHappyVersion: mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion,
  stopDaemon: vi.fn(async () => {}),
  listDaemonSessions: vi.fn(async () => []),
  stopDaemonSession: vi.fn(async () => true),
  notifyDaemonSessionStarted: mocks.mockNotifyDaemonSessionStarted,
};

const daemonRunModule = {
  startDaemon: vi.fn(async () => {}),
  initialMachineMetadata: {
    host: 'host',
    platform: 'darwin',
    happyCliVersion: 'test',
    homeDir: '/tmp',
    happyHomeDir: '/tmp/.happy',
    happyLibDir: '/tmp/happy',
  },
};

const uiLoggerModule = {
  logger: {
    debug: mocks.mockLoggerDebug,
  },
  getLatestDaemonLog: vi.fn(async () => null),
};

vi.mock('./daemon/controlClient', () => controlClientModule);
vi.mock('@/daemon/controlClient', () => controlClientModule);
vi.mock('./daemon/run', () => daemonRunModule);
vi.mock('@/daemon/run', () => daemonRunModule);
vi.mock('./ui/logger', () => uiLoggerModule);
vi.mock('@/ui/logger', () => uiLoggerModule);

vi.mock('./ui/auth', () => ({
  authAndSetupMachineIfNeeded: mocks.mockAuthAndSetupMachineIfNeeded,
}));

vi.mock('./utils/spawnHappyCLI', () => ({
  spawnHappyCLI: mocks.mockSpawnHappyCLI,
}));

vi.mock('./persistence', () => ({
  readSettings: mocks.mockReadSettings,
  readCredentials: mocks.mockReadCredentials,
}));

vi.mock('@/persistence', () => ({
  readSettings: mocks.mockReadSettings,
  readCredentials: mocks.mockReadCredentials,
}));

vi.mock('./api/api', () => ({
  ApiClient: {
    create: mocks.mockApiCreate,
  },
}));

vi.mock('@/api/api', () => ({
  ApiClient: {
    create: mocks.mockApiCreate,
  },
}));

vi.mock('@/utils/setupOfflineReconnection', () => ({
  setupOfflineReconnection: mocks.mockSetupOfflineReconnection,
}));

vi.mock('@/claude/registerKillSessionHandler', () => ({
  registerKillSessionHandler: mocks.mockKillRegister,
}));

vi.mock('@/claude/utils/startHappyServer', () => ({
  startHappyServer: mocks.mockStartHappyServer,
}));

vi.mock('@/projectPath', () => ({
  projectPath: mocks.mockProjectPath,
}));

vi.mock('@/utils/serverConnectionErrors', () => ({
  connectionState: {
    setBackend: mocks.mockSetBackend,
  },
}));

vi.mock('@/claude/runClaude', () => ({
  runClaude: vi.fn(async () => {}),
}));

vi.mock('./daemon/doctor', () => ({
  killRunawayHappyProcesses: vi.fn(async () => ({ killed: 0, errors: [] })),
}));

vi.mock('./daemon/install', () => ({
  install: vi.fn(async () => {}),
}));

vi.mock('./daemon/uninstall', () => ({
  uninstall: vi.fn(async () => {}),
}));

vi.mock('./ui/doctor', () => ({
  runDoctorCommand: vi.fn(async () => {}),
}));

vi.mock('./commands/auth', () => ({
  handleAuthCommand: vi.fn(async () => {}),
}));

vi.mock('./commands/connect', () => ({
  handleConnectCommand: vi.fn(async () => {}),
}));

vi.mock('./commands/sandbox', () => ({
  handleSandboxCommand: vi.fn(async () => {}),
}));

vi.mock('./claude/claudeLocal', () => ({
  claudeCliPath: '/tmp/claude',
}));

vi.mock('./utils/sandboxFlags', () => ({
  extractNoSandboxFlag: vi.fn((args: string[]) => ({ args, noSandbox: false })),
}));

describe.skipIf(!runRealCopilotTest || !hasCopilotCli)('index copilot real CLI flow', () => {
  const originalArgv = [...process.argv];
  let exitSpy: any;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.sessionHandlers.clear();
    mocks.setUserMessageHandler(null);
    mocks.setKillHandler(null);

    process.argv = ['node', 'happy', 'copilot', '--started-by', 'daemon', '--verbose', '--allow-all-tools'];
    mocks.mockSpawnHappyCLI.mockReturnValue({ unref: vi.fn() });
    mocks.mockApiCreate.mockResolvedValue({
      getOrCreateMachine: mocks.mockGetOrCreateMachine,
      getOrCreateSession: mocks.mockGetOrCreateSession,
    });
    mocks.mockSetupOfflineReconnection.mockImplementation(() => ({
      session: mocks.mockSession,
      reconnectionHandle: { cancel: vi.fn() },
      isOffline: false,
    }));
    mocks.mockStartHappyServer.mockResolvedValue({
      url: 'http://127.0.0.1:9876',
      stop: vi.fn(),
    });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number | string | null) => {
      throw new Error(`process.exit(${String(code ?? 0)})`);
    }) as any);
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    exitSpy.mockRestore();
  });

  it('passes app message through daemon to real copilot and returns reply to app', { timeout: 180_000 }, async () => {
    const token = 'HAPPY_REAL_FLOW_OK_42';
    await import('./index');

    await vi.waitFor(() => {
      expect(mocks.getUserMessageHandler()).toBeTypeOf('function');
    }, { timeout: 30_000 });

    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: `Reply with exactly ${token} and nothing else.` },
    });

    await vi.waitFor(() => {
      expect(mocks.mockSession.sendSessionEvent).toHaveBeenCalledWith({ type: 'ready' });
    }, { timeout: 120_000 });

    const envelopes = mocks.mockSession.sendSessionProtocolMessage.mock.calls.map(([envelope]) => envelope);
    const textPayload = envelopes
      .filter((envelope) => envelope?.ev?.t === 'text')
      .map((envelope) => String(envelope.ev.text ?? ''))
      .join('\n');

    expect(textPayload).toContain(token);
    expect(mocks.mockNotifyDaemonSessionStarted).toHaveBeenCalledWith(
      'session-real-1',
      expect.objectContaining({
        flavor: 'copilot',
        startedBy: 'daemon',
        startedFromDaemon: true,
      }),
    );

    const kill = mocks.getKillHandler();
    expect(kill).toBeTypeOf('function');
    await kill!();
    await vi.waitFor(() => {
      expect(mocks.mockSession.close).toHaveBeenCalled();
    }, { timeout: 30_000 });

    expect(mocks.mockAuthAndSetupMachineIfNeeded).toHaveBeenCalledTimes(1);
    expect(mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion).toHaveBeenCalledTimes(1);
    expect(mocks.mockSpawnHappyCLI).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
