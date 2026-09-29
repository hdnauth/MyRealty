/**
 * 오류 문구에 섞인 API 키를 가린다(서버·브라우저 공용). 예전 ETL 이 예외 repr 을 그대로 저장해
 * job_runs·item_collect_runs 에 serviceKey 가 든 URL 이 남아 있을 수 있다.
 */
const SECRET_PARAM = /\b(serviceKey|key|apiKey|api_key|crtfc_key|confmKey|KEY)=([^&\s'"]+)/gi;

export function redactSecrets(text: string): string {
  return text.replace(SECRET_PARAM, "$1=***");
}
