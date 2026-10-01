// AI 제공자 카탈로그(서버·설정 화면 공용). 키·요청은 서버에서만 다룬다.

export const AI_PROVIDERS = ["anthropic", "openai", "gemini", "deepseek", "mimo", "ollama"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export type ProviderInfo = {
  label: string;
  /** anthropic: Claude SDK, openai: OpenAI Chat Completions 호환 API */
  protocol: "anthropic" | "openai";
  defaultBaseUrl: string;
  /** API 키 없이도 쓸 수 있음(Ollama 로컬) */
  keyOptional?: boolean;
  /** 출력 토큰 상한 파라미터 이름 */
  tokenParam: "max_tokens" | "max_completion_tokens";
  /** 구조화 출력: json_schema 지원 여부(아니면 json_object + 프롬프트의 스키마) */
  jsonSchema: boolean;
  /** 같은 턴의 도구 호출 사이에 reasoning_content 를 되돌려 보내야 하는 제공자(DeepSeek·MiMo 사고 모드) */
  echoReasoning?: boolean;
  keyHint: string;
  keyUrl?: string;
  /** 모델 목록을 못 불러올 때 고를 수 있는 예시 */
  suggested: string[];
};

export const PROVIDER_INFO: Record<AiProvider, ProviderInfo> = {
  anthropic: {
    label: "Anthropic Claude",
    protocol: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    tokenParam: "max_tokens",
    jsonSchema: true,
    keyHint: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
    suggested: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
  },
  openai: {
    label: "OpenAI GPT",
    protocol: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    tokenParam: "max_completion_tokens",
    jsonSchema: true,
    keyHint: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
    suggested: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
  },
  gemini: {
    label: "Google Gemini",
    protocol: "openai",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    tokenParam: "max_tokens",
    jsonSchema: true,
    keyHint: "AIza…",
    keyUrl: "https://aistudio.google.com/apikey",
    suggested: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  deepseek: {
    label: "DeepSeek",
    protocol: "openai",
    defaultBaseUrl: "https://api.deepseek.com",
    tokenParam: "max_tokens",
    jsonSchema: false,
    echoReasoning: true,
    keyHint: "sk-…",
    keyUrl: "https://platform.deepseek.com/api_keys",
    suggested: ["deepseek-chat", "deepseek-reasoner"],
  },
  mimo: {
    label: "Xiaomi MiMo",
    protocol: "openai",
    defaultBaseUrl: "https://api.xiaomimimo.com/v1",
    tokenParam: "max_completion_tokens",
    jsonSchema: false,
    echoReasoning: true,
    keyHint: "sk-…",
    keyUrl: "https://platform.xiaomimimo.com",
    suggested: ["mimo-v2.6-pro", "mimo-v2.6-flash", "mimo-v2.5-pro"],
  },
  ollama: {
    label: "Ollama (자체 서버)",
    protocol: "openai",
    defaultBaseUrl: "http://localhost:11434/v1",
    keyOptional: true,
    tokenParam: "max_tokens",
    jsonSchema: true,
    keyHint: "비워 두면 키 없이 접속",
    suggested: ["qwen3", "llama3.1", "gpt-oss:20b"],
  },
};

export function isAiProvider(v: unknown): v is AiProvider {
  return typeof v === "string" && (AI_PROVIDERS as readonly string[]).includes(v);
}

/** 제공자·모델별 출력 토큰 상한(요청값을 넘지 않게 자른다) */
export function maxOutputTokens(provider: AiProvider, model: string, wanted: number): number {
  if (provider === "deepseek") return Math.min(wanted, /reasoner/.test(model) ? 32000 : 8192);
  return wanted;
}
