import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  const backendState = {
    listeners: [] as Array<(message: any) => void>,
    prompts: [] as Array<{ sessionId: string; prompt: string }>,
    startSessionCalls: 0,
    constructorArgs: null as any,
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
    mockGetOrCreateSession: vi.fn(async () => ({ id: 'session-1' })),
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
    backendState,
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

const acpBackendModule = {
  AcpBackend: class MockAcpBackend {
    constructor(args: any) {
      mocks.backendState.constructorArgs = args;
    }

    onMessage(handler: (message: any) => void) {
      mocks.backendState.listeners.push(handler);
    }

    offMessage(handler: (message: any) => void) {
      mocks.backendState.listeners = mocks.backendState.listeners.filter((item) => item !== handler);
    }

    async startSession() {
      mocks.backendState.startSessionCalls += 1;
      return { sessionId: 'acp-session-1' };
    }

    async sendPrompt(sessionId: string, prompt: string) {
      mocks.backendState.prompts.push({ sessionId, prompt });
      for (const listener of mocks.backendState.listeners) {
        listener({ type: 'status', status: 'running' });
        listener({ type: 'model-output', textDelta: 'hello' });
        listener({ type: 'tool-call', toolName: 'ReadFile', args: { path: 'README.md' }, callId: 'tool-1' });
        listener({ type: 'tool-result', toolName: 'ReadFile', result: { ok: true }, callId: 'tool-1' });
        listener({ type: 'status', status: 'idle' });
      }
    }

    async setSessionConfigOption() {
      return true;
    }

    async setSessionMode() {
      return true;
    }

    async setSessionModel() {
      return true;
    }

    async cancel() {
      for (const listener of mocks.backendState.listeners) {
        listener({ type: 'status', status: 'stopped' });
      }
    }

    async dispose() {}
  },
};

vi.mock('./agent/acp/AcpBackend', () => acpBackendModule);
vi.mock('@/agent/acp/AcpBackend', () => acpBackendModule);

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

describe('index copilot top-level command', () => {
  const originalArgv = [...process.argv];
  let exitSpy: any;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.sessionHandlers.clear();
    mocks.setUserMessageHandler(null);
    mocks.setKillHandler(null);
    mocks.backendState.listeners = [];
    mocks.backendState.prompts = [];
    mocks.backendState.startSessionCalls = 0;
    mocks.backendState.constructorArgs = null;

    process.argv = ['node', 'happy', 'copilot', '--started-by', 'daemon', '--verbose', '--custom-flag'];
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

  it('routes top-level copilot and reaches app reply path', async () => {
    await import('./index');

    await vi.waitFor(() => {
      expect(mocks.getUserMessageHandler()).toBeTypeOf('function');
    });

    mocks.getUserMessageHandler()!({
      role: 'user',
      content: { type: 'text', text: 'Please build an API test script' },
    });

    await vi.waitFor(() => {
      expect(mocks.backendState.prompts).toHaveLength(1);
    });

    await mocks.getKillHandler()!();

    await vi.waitFor(() => {
      expect(mocks.mockSession.close).toHaveBeenCalled();
    });

    expect(mocks.backendState.constructorArgs.command).toBe('copilot');
    expect(mocks.backendState.constructorArgs.args).toEqual(['--acp', '--custom-flag']);
    expect(mocks.backendState.constructorArgs.verbose).toBe(true);
    expect(mocks.backendState.startSessionCalls).toBe(1);
    expect(mocks.mockSession.onUserMessage).toHaveBeenCalledTimes(1);
    expect(mocks.backendState.prompts[0]).toEqual({
      sessionId: 'acp-session-1',
      prompt: 'Please build an API test script',
    });

    const envelopes = mocks.mockSession.sendSessionProtocolMessage.mock.calls.map(([envelope]) => envelope);
    const envelopeTypes = envelopes.map((envelope) => envelope.ev.t);
    expect(envelopeTypes).toEqual(['turn-start', 'text', 'tool-call-start', 'tool-call-end', 'turn-end']);
    expect(envelopes[1]?.ev).toEqual({
      t: 'text',
      text: 'hello',
    });
    expect(mocks.mockSession.sendSessionEvent).toHaveBeenCalledWith({ type: 'ready' });
    expect(mocks.mockNotifyDaemonSessionStarted).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        flavor: 'copilot',
        startedBy: 'daemon',
        startedFromDaemon: true,
      }),
    );
    expect(mocks.mockAuthAndSetupMachineIfNeeded).toHaveBeenCalledTimes(1);
    expect(mocks.mockIsDaemonRunningCurrentlyInstalledHappyVersion).toHaveBeenCalledTimes(1);
    expect(mocks.mockSpawnHappyCLI).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
