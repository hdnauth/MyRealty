-- 지도 조건 검색(/api/map/points)·단지 거래 조회용 커버링 인덱스.
-- transactions 는 행이 넓어(원본 응답 포함) 처음 보는 지역에서 본 테이블을 읽느라 수 초가 걸렸다.
-- 집계에 쓰는 열을 인덱스에 담아 인덱스만 읽고 끝나게 한다(취소 거래 제외 부분 인덱스).
create index if not exists tx_complex_cover_idx on transactions (complex_id, deal_kind, deal_date)
  include (price, area_m2, property_type)
  where not is_canceled;
