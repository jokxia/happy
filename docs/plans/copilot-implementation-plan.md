# Happy-Copilot-实现方案文档

| 属性 | 值 |
| :---- | :---- |
| **文档版本** | **v1.0** |
| **创建日期** | 2026-02-19 |
| **当前状态** | **方案设计 (Design)** |
| **负责人** | 产品架构团队 |
| **所属微服务** | happy-cli (LOCAL) |
| **关联服务** | happy-app (WEB/MOBILE), happy-server (API:3005), happy-wire (Protocol) |

---

## 目录

- [第 0 章：概念速查](#第-0-章概念速查)
- [第 1 章：研究概述](#第-1-章研究概述)
- [第 2 章：MVP 方案（ACP 接入 Copilot）](#第-2-章mvp-方案acp-接入-copilot)
- [第 3 章：GA 方案（Copilot 一等公民）](#第-3-章ga-方案copilot-一等公民)
- [第 4 章：鉴权与 Connect 体系设计](#第-4-章鉴权与-connect-体系设计)
- [第 5 章：兼容迁移与数据策略](#第-5-章兼容迁移与数据策略)
- [第 6 章：验证测试与质量门禁](#第-6-章验证测试与质量门禁)
- [第 7 章：发布与回滚方案](#第-7-章发布与回滚方案)
- [第 8 章：通用设计规范](#第-8-章通用设计规范)
- [附录：参考资料与更新日志](#附录参考资料与更新日志)

---

## 第 0 章：概念速查

### 0.1 术语表

| 术语 | 英文 | 定义 |
|------|------|------|
| Agent | Agent | 会话执行主体，如 claude/codex/gemini/cpilot(acp) |
| ACP | Agent Client Protocol | 代理协议层，支持通用事件、mode/model 元数据、工具调用桥接 |
| Flavor | Session Flavor | 会话元数据中的运行标识，如 `claude`、`codex`、`gemini`、`acp` |
| Vendor | Vendor | 云端凭据分类键，用于 connect token 存储（如 openai/anthropic/gemini/copilot） |
| Spawn | Session Spawn | 由 App/Server 通过 daemon RPC 在目标机器拉起会话进程 |
| CLI Detection | CLI Detection | 在机器侧探测某个 agent 可执行是否可用 |
| Profile Compatibility | Profile Compatibility | profile 对不同 agent 的兼容矩阵，决定可选与默认切换逻辑 |

### 0.2 架构速览

```text
┌────────────────────────────────────────────────────────────────────┐
│                           happy-app                                │
│  New Session / Settings / Connected Accounts / CLI Detection       │
└───────────────┬────────────────────────────────────────────────────┘
                │ RPC: spawn-happy-session
┌───────────────▼────────────────────────────────────────────────────┐
│                          happy-server                               │
│   machine RPC relay + connect vendor token APIs                    │
└───────────────┬────────────────────────────────────────────────────┘
                │ ws/rpc
┌───────────────▼────────────────────────────────────────────────────┐
│                         happy daemon                                │
│  spawn: happy claude|codex|gemini|acp ...                          │
└───────────────┬────────────────────────────────────────────────────┘
                │ stdio/acp
┌───────────────▼────────────────────────────────────────────────────┐
│                    Agent Runtime Layer                              │
│   claude native / codex mcp / gemini acp / copilot(acp in MVP)     │
└────────────────────────────────────────────────────────────────────┘
```

### 0.3 核心数据结构速查（设计态）

```typescript
// MVP：remote spawn 协议扩展（不改已有字段语义）
interface SpawnSessionParamsV2 {
  type: 'spawn-in-directory';
  directory: string;
  approvedNewDirectoryCreation?: boolean;
  agent?: 'claude' | 'codex' | 'gemini' | 'acp';
  // 仅当 agent='acp' 时有效
  acpAgentName?: string; // e.g. "copilot"
  acpCommand?: string;   // e.g. "copilot"
  acpArgs?: string[];    // e.g. ["--experimental-acp"]
  token?: string;
  environmentVariables?: Record<string, string>;
}

// GA：统一类型治理（跨 cli/app/server）
type AgentType = 'claude' | 'codex' | 'gemini' | 'copilot' | 'acp';
type VendorType = 'anthropic' | 'openai' | 'gemini' | 'copilot';

interface ProfileCompatibility {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
  copilot: boolean;
}
```

### 0.4 架构匹配度评估

| 能力项 | 现有状态 | 匹配度 | 说明 |
|--------|---------|-------|------|
| ACP 通用运行能力 | ✅ 已支持 | 90% | `happy acp` 已可运行任意 ACP 命令 |
| App 远程拉起 ACP | ⚠️ 部分支持 | 40% | spawn `agent` 枚举限制为三元 |
| Connect vendor 扩展能力 | ⚠️ 部分支持 | 50% | DB 为 string，但 API zod 枚举受限 |
| UI 一等公民呈现 | ❌ 不支持 | 20% | 文案/图标/检测/告警均是三元硬编码 |
| 向后兼容基础 | ✅ 已支持 | 80% | flavor 与 settings 多为 string/可扩展结构 |

---

## 第 1 章：研究概述

### 1.1 背景与目标

**业务背景：**  
当前 Happy 已支持 Claude/Codex/Gemini，但 Copilot 无法在「新建会话→远程拉起→账户连接→状态可视」链路内闭环。现有 ACP 能力可作为快速接入基础，但产品层仍缺少一等公民支持。

**核心目标：**
1. **P0：尽快可用** — 先让 Copilot 可通过 ACP 从 App 远程拉起并稳定对话。
2. **P1：产品一致** — 完成 connect、检测、profile、UI、文案的一致化支持。
3. **P2：可维护** — 消除跨层三元硬编码，建立可扩展 Agent/Vendor 类型治理。

**预期收益：**
- **用户价值：** 一个入口统一管理多 Agent，会话创建与切换更顺滑。  
- **业务价值：** 提升 Happy 对多生态代理的覆盖能力与留存。  
- **技术价值：** 降低后续新增 Agent 的改造成本和回归风险。

### 1.2 需求来源表

| 来源 | 需求描述 | 优先级 |
|------|---------|--------|
| 用户诉求 | “先分析设计，不实施编码；给出可落地实现方案并落本地文档” | P0 |
| 架构现状 | 当前 `claude/codex/gemini` 枚举限制导致 Copilot 链路断裂 | P0 |
| 工程演进 | 需要把新增 Agent 变成可复用流程，而非重复硬编码 | P1 |

### 1.3 差异化定位矩阵

| 差异化方向 | 具体特点 | 竞争优势 |
|-----------|---------|----------|
| 🔧 渐进式落地 | 先 ACP MVP 再一等公民 GA | 快速验证 + 可控风险 |
| 💡 类型治理 | 统一 Agent/Vendor 类型层 | 后续扩展新 agent 成本更低 |
| 🎯 全链路体验 | connect + spawn + 检测 + UI 统一 | 避免“能连不能用/能用不能管”割裂 |

### 1.4 方案对比

| 方案 | 上线速度 | 改造范围 | 用户体验完整度 | 推荐 |
|------|---------|---------|----------------|------|
| A：仅 ACP MVP | 快 | 小 | 中 | ✅ 先做 |
| B：直接一等公民 | 慢 | 大 | 高 | ⚠️ 风险高 |
| A→B 分阶段 | 中 | 可控 | 高 | ✅ 最优 |

---

## 第 2 章：MVP 方案（ACP 接入 Copilot）

### 2.1 用户故事

#### US-MVP-001：从 App 新建 Copilot 会话（ACP）

**作为** Happy 用户  
**我想要** 在新建会话页选择 Copilot（ACP）并远程拉起  
**以便于** 在不改动现有三大 agent 主路径的情况下快速使用 Copilot

**验收标准：**
1. 目标机器检测到 `copilot` 可执行时，界面可选 Copilot(ACP)。
2. 点击创建后，daemon 能拉起 `happy acp` 并进入会话。
3. 会话消息可正常展示，`thinking/ready` 状态可同步。
4. 出错时给出明确原因（CLI 未安装、参数无效、spawn 失败）。
5. 不影响 claude/codex/gemini 创建流程。

### 2.2 UI/UX 设计

#### 2.2.1 信息架构树

```text
新建会话
├── Agent 选择
│   ├── Claude
│   ├── Codex
│   ├── Gemini
│   └── Copilot (ACP)
├── 机器选择
├── 路径选择
└── 会话创建
```

#### 2.2.2 交互设计说明表

| 交互场景 | 触发方式 | 动作 | 反馈 |
|---------|---------|------|------|
| Copilot CLI 未检测到 | 进入新建会话页 | 显示 warning banner | “Copilot CLI Not Detected” |
| 选择 Copilot(ACP) | 点击 agent 按钮 | 切换 agent 并保留路径等输入 | Agent chip 更新 |
| 创建会话失败 | 点击创建 | 返回错误码映射提示 | Modal 明确失败原因 |

### 2.3 技术实现（设计）

#### 2.3.1 协议与进程链路

```typescript
// App -> Server RPC payload（设计）
{
  agent: 'acp',
  acpAgentName: 'copilot',
  acpCommand: 'copilot',
  acpArgs: ['--experimental-acp'],
  directory: '/path/to/repo'
}
```

#### 2.3.2 Daemon 行为设计

1. `spawn-happy-session` 接收 `agent='acp'` 时进入 ACP 分支。  
2. 使用 `happy acp -- <command> <args...>` 或等价方式拉起。  
3. 元数据 flavor 标注为 `acp`（可附加 `agentName='copilot'` 便于 UI 呈现）。  
4. 与现有 ACP 会话共用消息映射与 session 事件上报。

#### 2.3.3 使用示例（逻辑示例）

```bash
# 远程 spawn 等价执行（概念示例）
happy acp -- copilot --experimental-acp
```

### 2.4 异常处理

| 异常场景 | 处理方式 | 降级策略 | 用户提示 |
|---------|---------|---------|------------|
| 机器未安装 copilot CLI | 检测返回 false | 禁用 Copilot 选项 | “Copilot CLI Not Detected” |
| daemon 不识别 acp 参数 | 参数校验失败 | 回退到错误弹窗 | “Unsupported spawn config” |
| ACP 握手失败 | 记录日志 + 终止会话创建 | 不影响其他 agent | “Copilot ACP handshake failed” |

### 2.5 性能指标

| 指标 | 目标值 | 测量方法 |
|------|--------|----------|
| 会话创建耗时（MVP） | < 6s | App 点击创建到 sessionId 返回 |
| 首条输出延迟 | < 10s | `sendMessage` 到第一条 agent 输出 |
| 失败可诊断率 | > 95% | 失败事件含可读错误码/原因 |

---

## 第 3 章：GA 方案（Copilot 一等公民）

### 3.1 用户故事

#### US-GA-001：作为一等公民使用 Copilot

**作为** Happy 用户  
**我想要** 使用 `happy copilot`、`happy connect copilot`、App 图形化入口完整管理  
**以便于** 获得与 Claude/Codex/Gemini 等价的一致体验

**验收标准：**
1. CLI 支持 `happy copilot` 启动与 `happy connect copilot` 鉴权。
2. App 支持 Copilot profile compatibility、检测、告警、图标和文案。
3. Server connect APIs 支持 copilot vendor token 存取与断连。
4. Account 页面显示 Copilot Connected Account 并可断开。
5. 历史会话与旧 settings 不受破坏。

### 3.2 UI/UX 设计

#### 3.2.1 信息架构树

```text
Settings
├── Connected Accounts
│   ├── Claude
│   ├── Codex
│   ├── Gemini
│   └── Copilot
└── New Session
    ├── Agent Selector (4 agents)
    ├── Profile Compatibility (含 copilot)
    └── CLI Warnings (含 copilot)
```

#### 3.2.2 交互设计说明表

| 交互场景 | 触发方式 | 动作 | 反馈 |
|---------|---------|------|------|
| connect copilot | CLI 命令 | 完成 OAuth/token 注册 | “Copilot connected” |
| Copilot 断连 | 设置页点击断连 | 调用 disconnect API | “Disconnected successfully” |
| profile 不兼容 | 选中 profile | 禁止创建并显示原因 | “This profile requires Copilot” |

### 3.3 技术实现（设计）

#### 3.3.1 类型治理

```typescript
// 统一定义，替代散落联合类型
export type AgentType = 'claude' | 'codex' | 'gemini' | 'copilot' | 'acp';
export type VendorType = 'anthropic' | 'openai' | 'gemini' | 'copilot';
```

#### 3.3.2 分层改造面

| 层级 | 设计改造点 |
|------|-----------|
| CLI | `index.ts` 增加 copilot 子命令；`connect.ts` 增加 connect/status 显示；daemon spawn 分支支持 copilot |
| Server | `connectRoutes` vendor enum 扩展；token 获取/删除对 copilot 生效 |
| App | `new/index.tsx` agent 枚举扩展；`useCLIDetection` 增加 copilot；settings/account 显示与断连；i18n 文案补齐 |

### 3.4 异常处理

| 异常场景 | 处理方式 | 降级策略 | 用户提示 |
|---------|---------|---------|------------|
| connect 成功但 token 失效 | 启动前校验 token | 提示重新 connect | “Token expired, please reconnect Copilot” |
| 文案未覆盖语言包 | 默认回退英文 key | 不阻断功能 | 显示英文兜底文案 |
| 类型扩展遗漏 | CI 类型门禁拦截 | 阻断发布 | “AgentType incomplete mapping” |

### 3.5 性能指标

| 指标 | 目标值 | 测量方法 |
|------|--------|----------|
| 新增 agent 回归失败率 | < 2% | 回归用例统计 |
| connect 成功率 | > 98% | server connect API 监控 |
| 会话创建成功率 | > 97% | spawn 成功率监控 |

---

## 第 4 章：鉴权与 Connect 体系设计

### 4.1 用户故事

#### US-AUTH-001：统一的凭据管理

**作为** 用户  
**我想要** 在 Happy 里统一管理 Copilot 凭据  
**以便于** 在多设备上保持一致体验并可随时断连

**验收标准：**
1. 凭据按 vendor 维度加密存储，支持增删查。
2. 断连后会话创建不再使用旧 token。
3. 错误信息不泄露敏感字段。
4. 支持 token 轮转，不影响已有会话稳定性。
5. 与 GitHub 账户连接逻辑边界清晰，不相互污染。

### 4.2 鉴权方案设计对比

| 方案 | 描述 | 优点 | 风险 | 结论 |
|------|------|------|------|------|
| 独立 copilot vendor token | `connect copilot` 单独存储 | 解耦清晰、可控性高 | 新增接入工作量 | ✅ 推荐主路径 |
| 复用 github token | 使用 GitHub OAuth token 推导 | 复用现有登录 | scope/过期/耦合复杂 | ⚠️ 仅兼容选项 |

### 4.3 技术实现（设计）

```typescript
interface VendorTokenRecord {
  vendor: 'copilot';
  token: string;        // encrypted
  metadata?: {
    scope?: string[];
    expiresAt?: number;
  };
}
```

### 4.4 异常处理

| 异常场景 | 处理方式 | 降级策略 | 用户提示 |
|---------|---------|---------|------------|
| OAuth 回调失败 | 返回标准错误码 | 保留当前连接状态 | “Copilot auth failed” |
| token 解密失败 | 记录告警并返回空 token | 要求用户重连 | “Please reconnect Copilot” |

### 4.5 性能指标

| 指标 | 目标值 | 测量方法 |
|------|--------|----------|
| connect API p95 延迟 | < 300ms | API 网关指标 |
| token 读取 p95 延迟 | < 100ms | 服务端查询指标 |

---

## 第 5 章：兼容迁移与数据策略

### 5.1 用户故事

#### US-MIG-001：平滑升级

**作为** 已有用户  
**我想要** 在升级后继续使用历史会话与设置  
**以便于** 不因新增 Copilot 造成配置丢失或行为变化

**验收标准：**
1. 旧 settings/profile 可正常加载。
2. 未配置 Copilot 的用户不受影响。
3. 旧三元 agent 的 UI 行为保持一致。
4. 新字段具备默认值与向后兼容逻辑。
5. 升级失败可快速回退。

### 5.2 迁移设计

| 对象 | 迁移策略 | 兼容要求 |
|------|---------|---------|
| `ProfileCompatibility` | 新增 `copilot:boolean` 默认 false | 旧 profile 自动补全 |
| `dismissedCLIWarnings` | 新增 `copilot` 键 | 不影响原有三键 |
| Agent selector state | 从三元扩展到可配置列表 | 旧值回退到 `claude` |

### 5.3 技术实现（设计）

```typescript
function migrateCompatibility(input: any): ProfileCompatibility {
  return {
    claude: !!input?.claude,
    codex: !!input?.codex,
    gemini: !!input?.gemini,
    copilot: !!input?.copilot, // default false
  };
}
```

### 5.4 异常处理

| 异常场景 | 处理方式 | 降级策略 | 用户提示 |
|---------|---------|---------|------------|
| 旧 settings 解析失败 | 按默认值修复并保留未知字段 | 继续运行 | “Settings migrated with defaults” |
| profile 字段缺失 | 自动补齐 | 禁止崩溃 | 无需用户感知 |

### 5.5 性能指标

| 指标 | 目标值 | 测量方法 |
|------|--------|----------|
| 设置迁移耗时 | < 50ms | 启动日志计时 |
| 迁移失败率 | < 0.1% | 错误上报统计 |

---

## 第 6 章：验证测试与质量门禁

### 6.1 用户故事

#### US-QA-001：可验证上线

**作为** 发布负责人  
**我想要** 有完整测试矩阵和质量门禁  
**以便于** 在引入 Copilot 支持时确保不破坏现有能力

**验收标准：**
1. 覆盖 CLI/App/Server 三层关键路径测试。
2. 覆盖 connect、spawn、disconnect、warning、profile compatibility。
3. 明确回归范围：claude/codex/gemini 全量回归。
4. 失败可定位到模块与责任边界。
5. 发布前有 checklist 勾选记录。

### 6.2 测试矩阵

| 维度 | 用例 | 通过标准 |
|------|------|----------|
| CLI | `happy acp`/`happy connect status`/`happy copilot`(GA) | 命令成功退出、输出符合预期 |
| Server | connect token CRUD | 状态码与返回体正确 |
| App | 新建会话与设置页展示 | 入口可见、状态同步正确 |
| E2E | 从 connect 到创建会话到断连 | 全链路成功 |

### 6.3 质量门禁（发布前）

- 类型检查通过（零新增类型错误）  
- 关键路径测试通过（connect/spawn/disconnect）  
- 回归测试通过（claude/codex/gemini）  
- 监控与告警项已接入（连接失败率、创建失败率）

### 6.4 异常处理

| 异常场景 | 处理方式 | 降级策略 | 用户提示 |
|---------|---------|---------|------------|
| 回归失败 | 阻断发布 | 回退 feature flag | “Release blocked by quality gate” |
| 线上错误率突增 | 触发自动告警 | 回滚到上一稳定版本 | “Temporarily disabled Copilot entry” |

### 6.5 性能指标

| 指标 | 目标值 | 测量方法 |
|------|--------|----------|
| 回归执行时长增量 | < +20% | CI pipeline 对比 |
| 线上错误告警延迟 | < 2 分钟 | 监控系统事件时间差 |

---

## 第 7 章：发布与回滚方案

### 7.1 用户故事

#### US-REL-001：分阶段可控发布

**作为** 运维/发布团队  
**我想要** 按阶段上线并可快速回退  
**以便于** 将新增能力风险降到可控范围

**验收标准：**
1. A 阶段支持开关控制（实验开关）。
2. B 阶段支持灰度发布与观察窗口。
3. 回滚步骤明确可执行（配置/代码/数据）。
4. 有明确停止发布条件（error budget 超阈值）。
5. 发布过程责任人清晰。

### 7.2 发布波次

| 波次 | 范围 | 目标 | 退出条件 |
|------|------|------|---------|
| Wave-1 | 内测 | 验证 MVP ACP 链路 | 创建成功率 > 95% |
| Wave-2 | 小流量 | 验证稳定性与监控 | 错误率 < 2% |
| Wave-3 | 全量 | 开放给全体用户 | 关键指标稳定 7 天 |

### 7.3 回滚方案

1. 关闭 Copilot 入口 feature flag。  
2. 恢复旧 agent selector 三元展示。  
3. 保留已存 token 数据，不主动删除。  
4. 发布公告说明临时回退原因与恢复计划。

### 7.4 异常处理

| 异常场景 | 处理方式 | 降级策略 | 用户提示 |
|---------|---------|---------|------------|
| 全量后错误率升高 | 立即回滚入口 | 保留三大 agent 可用 | “Copilot 正在维护中” |
| connect 服务抖动 | 降级只读状态页 | 暂停新 connect | “Connect temporarily unavailable” |

### 7.5 性能指标

| 指标 | 目标值 | 测量方法 |
|------|--------|----------|
| 发布失败恢复时间 | < 15 分钟 | 回滚演练记录 |
| 灰度阶段用户投诉率 | < 1% | 客诉系统统计 |

---

## 第 8 章：通用设计规范

### 8.1 命名规范

- Agent 命名：小写 kebab/camel 统一，展示名与内部 key 分离。  
- Vendor 命名：与 connect API 参数一致（`copilot`）。  
- 错误码命名：`COPILOT_*` 前缀，便于观测与检索。

### 8.2 技术规范

- 新增 agent/vender 必须经过共享类型层，不允许业务层散落字面量。  
- metadata flavor 必须可扩展，不允许以未知值直接回退为 Claude 语义。  
- i18n key 必须在默认语言和主流翻译文件中补齐。

### 8.3 错误码规范（建议）

| 错误码 | 含义 | 用户可见文案 |
|-------|------|-------------|
| COPILOT_CLI_NOT_FOUND | 目标机器未安装 Copilot CLI | Copilot CLI Not Detected |
| COPILOT_CONNECT_FAILED | 鉴权连接失败 | Copilot connect failed |
| COPILOT_SPAWN_FAILED | 会话拉起失败 | Failed to start Copilot session |
| COPILOT_TOKEN_EXPIRED | token 过期 | Please reconnect Copilot |

### 8.4 性能优化建议

1. CLI 检测采用单次批量命令，避免多次 RPC。  
2. 会话创建失败原因标准化，减少重试次数。  
3. 连接状态与 profile 兼容判断结果缓存，降低渲染开销。

---

## 附录：参考资料与更新日志

### A. 参考资料

- `docs/cli-architecture.md`
- `docs/protocol.md`
- `docs/plans/generic-acp-runner.md`
- `packages/happy-cli/src/daemon/run.ts`
- `packages/happy-app/sources/app/(app)/new/index.tsx`
- `packages/happy-server/sources/app/api/routes/connectRoutes.ts`

### B. 更新日志

| 版本 | 日期 | 作者 | 变更说明 |
|------|------|------|---------|
| v1.0 | 2026-02-19 | Product Doc Writer | 初版：完成 Copilot 分阶段实现方案（MVP ACP + GA 一等公民） |

### C. 质量检查结果（本次）

- [x] 文档元数据完整  
- [x] 第 0~8 章完整  
- [x] 包含用户故事、技术实现、异常处理、性能指标  
- [x] 包含发布与回滚设计  
- [x] 包含更新日志与参考资料  

