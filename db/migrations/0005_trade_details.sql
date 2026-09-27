-- 실거래 상세 필드: 매수자·매도자 구분, 등기일자, 전월세 계약구분·종전 계약
-- (국토부 실거래 API 가 이미 주던 값. 원천 raw 에 남아 있으므로 기존 행도 채운다)

alter table transactions
  add column if not exists buyer_type    text,     -- 개인 | 법인 | 공공기관 | 기타 (매매)
  add column if not exists seller_type   text,
  add column if not exists registered_at date,     -- 소유권 이전 등기일(매매). 신고 후 몇 달 뒤 채워진다
  add column if not exists contract_type text,     -- new | renewal (전월세)
  add column if not exists prev_deposit  bigint,   -- 갱신 계약의 종전 보증금(만원)
  add column if not exists prev_rent     int;      -- 종전 월세(만원)

update transactions set
  buyer_type    = nullif(btrim(raw->>'buyerGbn'), ''),
  seller_type   = nullif(btrim(raw->>'slerGbn'), ''),
  registered_at = case
    when raw->>'rgstDate' ~ '^\d{2}\.\d{2}\.\d{2}$' then to_date(raw->>'rgstDate', 'YY.MM.DD')
    when raw->>'rgstDate' ~ '^\d{4}-\d{2}-\d{2}$' then (raw->>'rgstDate')::date
  end,
  contract_type = case btrim(raw->>'contractType') when '신규' then 'new' when '갱신' then 'renewal' end,
  prev_deposit  = nullif(regexp_replace(coalesce(raw->>'preDeposit', ''), '[^0-9]', '', 'g'), '')::bigint,
  prev_rent     = nullif(regexp_replace(coalesce(raw->>'preMonthlyRent', ''), '[^0-9]', '', 'g'), '')::int
where raw is not null and (raw ? 'buyerGbn' or raw ? 'rgstDate' or raw ? 'contractType' or raw ? 'preDeposit');
