# 인스타 자동 게시

- ig/queue/<계정>/<YYYY-MM-DD-HHMM>_<영문이름>/ 폴더에 1.jpg 2.jpg … 또는 video.mp4, caption.txt 를 넣으면 그 시간(한국 시간) 이후 첫 확인 때 올라갑니다.
- 계정 이름: onepass(합격연구소) · drbeautylab(닥터뷰티랩) · drawyourlife(당신을그리다) · jay(원장 대상)
- 한 번에 계정마다 하나씩만 올립니다. 올린 기록은 ig/posted.json.
- 깃허브 저장소 설정 > Secrets 에 계정마다 IG_ID_… 와 IG_TOKEN_… 을 넣어야 동작합니다.
- 시험 실행: Actions > 인스타 자동 게시 > Run workflow 에서 dry_run 칸에 1
