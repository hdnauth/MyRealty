"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { AI_PROVIDERS, type AiProvider, PROVIDER_INFO } from "@/lib/ai/providers";
import { clearAiSettingsAction, loadAiModelsAction, saveAiSettingsAction, testAiAction } from "./ai-actions";

type Saved = { provider: AiProvider; model: string; baseUrl: string | null; keyHint: string | null; updatedAt: string } | null;

export function AiSettings({ saved, serverDefault }: { saved: Saved; serverDefault: string | null }) {
  const [provider, setProvider] = useState<AiProvider | "">(saved?.provider ?? "");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? "");
  const [model, setModel] = useState(saved?.model ?? "");
  const [models, setModels] = useState<{ id: string; label?: string }[] | null>(null);
  const [manual, setManual] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const info = provider ? PROVIDER_INFO[provider] : null;
  // 저장된 키를 그대로 쓸 수 있는지(같은 제공자로 저장돼 있음)
  const hasSavedKey = Boolean(saved && saved.provider === provider && saved.keyHint);
  const form = () => ({ provider, model, apiKey, baseUrl });

  const loadModels = async () => {
    if (!provider) return;
    setLoadingModels(true);
    setMsg(null);
    const r = await loadAiModelsAction(form());
    setLoadingModels(false);
    if (r.models) {
      setModels(r.models);
      setManual(false);
      // 고른 모델이 없거나 목록에 없으면 추천 모델 → 첫 모델
      if (!model || !r.models.some((m) => m.id === model)) {
        const pick = PROVIDER_INFO[provider].suggested.find((s) => r.models!.some((m) => m.id === s)) ?? r.models[0].id;
        setModel(pick);
      }
    } else {
      setModels(null);
      setManual(true);
      setMsg({ ok: false, text: r.error ?? "모델 목록을 불러오지 못했습니다." });
    }
  };

  // 저장된 설정으로 처음 열면 모델 목록을 한 번 불러온다
  const loadedOnce = useRef(false);
  useEffect(() => {
    if (loadedOnce.current || !saved) return;
    loadedOnce.current = true;
    void loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeProvider = (p: AiProvider | "") => {
    setProvider(p);
    setModels(null);
    setMsg(null);
    setApiKey("");
    setBaseUrl(p && saved?.provider === p ? (saved.baseUrl ?? "") : "");
    setModel(p && saved?.provider === p ? saved.model : "");
    setManual(false);
  };

  const canQuery = Boolean(provider && (apiKey || hasSavedKey || info?.keyOptional));

  return (
    <div className="space-y-3 px-4 pb-4 text-sm">
      <Field label="AI 제공자">
        <Select value={provider} onChange={(e) => changeProvider(e.target.value as AiProvider | "")}>
          <option value="">{serverDefault ? `서버 기본 (${serverDefault})` : "선택하세요 (서버 기본 AI 없음)"}</option>
          {AI_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_INFO[p].label}
            </option>
          ))}
        </Select>
      </Field>

      {provider && info ? (
        <>
          <Field
            label={`API 키${info.keyOptional ? " (선택)" : ""}`}
            hint={
              <>
                {hasSavedKey ? `저장된 키 ${saved?.keyHint} — 바꿀 때만 입력하세요. ` : ""}
                키는 서버에 암호화해 저장하고 화면에 다시 보여 주지 않습니다.
                {info.keyUrl ? (
                  <>
                    {" "}
                    <a href={info.keyUrl} target="_blank" rel="noreferrer" className="text-accent">
                      키 발급 →
                    </a>
                  </>
                ) : null}
              </>
            }
          >
            <Input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onBlur={() => apiKey && !models && void loadModels()}
              placeholder={hasSavedKey ? "변경하지 않음" : info.keyHint}
            />
          </Field>

          <Field
            label={provider === "ollama" ? "서버 주소 (Base URL)" : "Base URL (선택)"}
            hint={
              provider === "ollama"
                ? "이 앱 서버에서 접속할 수 있는 Ollama 주소입니다(OpenAI 호환 /v1). 배포 서버라면 localhost 가 아니라 외부에서 닿는 주소여야 합니다."
                : "프록시·호환 게이트웨이를 쓸 때만 바꾸세요. 비우면 기본값."
            }
          >
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={info.defaultBaseUrl} inputMode="url" autoComplete="off" />
          </Field>

          <Field
            label="모델"
            hint={
              models
                ? `${models.length}개 모델을 서버에서 불러왔습니다.`
                : "키를 넣고 '모델 불러오기'를 누르면 이 계정에서 쓸 수 있는 모델 목록을 가져옵니다."
            }
          >
            <div className="flex gap-2">
              {models && !manual ? (
                <Select value={model} onChange={(e) => (e.target.value === "__manual" ? setManual(true) : setModel(e.target.value))}>
                  {!models.some((m) => m.id === model) && model ? <option value={model}>{model}</option> : null}
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label && m.label !== m.id ? `${m.label} (${m.id})` : m.id}
                    </option>
                  ))}
                  <option value="__manual">직접 입력…</option>
                </Select>
              ) : (
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={info.suggested[0]} list={`ai-suggest-${provider}`} autoComplete="off" />
              )}
              <datalist id={`ai-suggest-${provider}`}>
                {info.suggested.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <Button type="button" variant="secondary" className="shrink-0" disabled={!canQuery || loadingModels} onClick={() => void loadModels()}>
                {loadingModels ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                모델 불러오기
              </Button>
            </div>
          </Field>
        </>
      ) : (
        <p className="text-muted">
          {serverDefault
            ? "서버 기본 AI 를 씁니다(관리자가 정한 월 예산·개인 한도 적용). 본인 키를 등록하면 원하는 모델을 쓰고 비용은 본인 계정으로 청구됩니다."
            : "서버에 기본 AI 키가 없습니다. 제공자를 고르고 본인 API 키를 등록하세요."}
        </p>
      )}

      {msg ? <p className={msg.ok ? "text-ok" : "text-up"}>{msg.text}</p> : null}

      <div className="flex flex-wrap gap-2">
        {provider ? (
          <>
            <Button
              type="button"
              disabled={pending || !model || !canQuery}
              onClick={() =>
                start(async () => {
                  const r = await saveAiSettingsAction(form());
                  if (r.error) setMsg({ ok: false, text: r.error });
                  else {
                    setApiKey("");
                    setMsg({ ok: true, text: "저장했습니다. AI 질문·분석·비교·리포트에 이 모델을 씁니다." });
                  }
                })
              }
            >
              저장
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending || !model || !canQuery}
              onClick={() =>
                start(async () => {
                  setMsg({ ok: true, text: "연결 확인 중…" });
                  const r = await testAiAction(form());
                  setMsg({ ok: r.ok, text: r.message });
                })
              }
            >
              연결 테스트
            </Button>
          </>
        ) : null}
        {saved ? (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await clearAiSettingsAction();
                changeProvider("");
                setMsg({ ok: true, text: serverDefault ? "내 설정을 지웠습니다. 서버 기본 AI 를 씁니다." : "내 설정을 지웠습니다." });
              })
            }
          >
            내 설정 삭제
          </Button>
        ) : null}
      </div>
    </div>
  );
}
