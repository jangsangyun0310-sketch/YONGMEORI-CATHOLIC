#!/usr/bin/env node
// 성당 전달사항을 알림 구독자들에게 보내는 스크립트.
// 실행: npm run send-push -- "제목" "내용"
// scripts/serviceAccountKey.json 파일이 미리 있어야 합니다 (Firebase 콘솔에서 다운로드, .gitignore 처리됨).
const path = require('path');
const admin = require('firebase-admin');

const SITE_URL = 'https://jangsangyun0310-sketch.github.io/YONGMEORI-CATHOLIC/성당홈페이지.html';

let serviceAccount;
try {
  serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));
} catch (err) {
  console.error('scripts/serviceAccountKey.json 파일을 찾을 수 없습니다.');
  console.error('Firebase 콘솔 > 프로젝트 설정 > 서비스 계정 > "새 비공개 키 생성"으로 받은 파일을 여기에 저장해주세요.');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
  const [, , title, body] = process.argv;
  if (!title || !body) {
    console.error('사용법: npm run send-push -- "제목" "내용"');
    process.exit(1);
  }

  // 푸시 구독자가 없어도 홈페이지 알림함에는 남겨서, 나중에 방문한 분도 볼 수 있게 한다
  const announcementRef = await db.collection('announcements').add({
    title,
    body,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const snapshot = await db.collection('push_tokens').get();
  const tokens = snapshot.docs.map((d) => d.id);
  if (tokens.length === 0) {
    console.log('알림함에는 저장했지만, 아직 알림을 구독한 사람이 없어 푸시는 못 보냈습니다.');
    return;
  }

  // tag를 알림함 문서 id로 지정해두면, 홈페이지 알림함에서 지울 때 실제 휴대폰 알림도 같이 지울 수 있다
  const message = {
    notification: { title, body },
    data: { announcementId: announcementRef.id },
    webpush: {
      fcmOptions: { link: SITE_URL },
      notification: { icon: SITE_URL.replace('성당홈페이지.html', '') + 'images/icons/icon-192.png', tag: announcementRef.id }
    }
  };

  const chunks = [];
  for (let i = 0; i < tokens.length; i += 500) chunks.push(tokens.slice(i, i + 500));

  let successCount = 0;
  let failCount = 0;
  const invalidTokens = [];

  for (const chunk of chunks) {
    const res = await admin.messaging().sendEachForMulticast({ ...message, tokens: chunk });
    res.responses.forEach((r, idx) => {
      if (r.success) {
        successCount += 1;
      } else {
        failCount += 1;
        const code = r.error && r.error.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
          invalidTokens.push(chunk[idx]);
        }
      }
    });
  }

  if (invalidTokens.length > 0) {
    const batch = db.batch();
    invalidTokens.forEach((t) => batch.delete(db.collection('push_tokens').doc(t)));
    await batch.commit();
  }

  console.log(
    `발송 완료: 성공 ${successCount}건, 실패 ${failCount}건`
    + (invalidTokens.length ? `, 만료된 구독 ${invalidTokens.length}건 정리` : '')
    + ' (알림함에도 저장됨)'
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
