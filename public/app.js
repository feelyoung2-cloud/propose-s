// ===================================================================
// 과천시 수업 웹앱 - 공통 스크립트 (Firebase 10.x SDK & 로컬 시뮬레이션 지원)
// ===================================================================
import { firebaseConfig } from './firebase-config.js';

// 욕설 및 비속어 필터 목록 (초등학교 수업용)
export const BAD_WORDS = [
  '시발', '씨발', '개새끼', '존나', '병신', '지랄', '미친놈', '미친년', '새끼',
  '닥쳐', '죽어', '꺼져', '틀딱', '엠창', '창녀', '걸레', '장애인', '느금마',
  '바보새끼', '멍청이새끼', '애미', '애비', '호구', '새키', '씹', 'ㅅㅂ', 'ㅂㅅ',
  'ㅈㄹ', 'ㅈㄴ', 'ㅄ', 'ㅆㅂ', 'ㄲㅈ', 'ㄷㅊ', '새기', '년', '놈'
];

/**
 * 텍스트에 비속어가 포함되어 있는지 검사합니다.
 */
export function checkBadWords(text) {
  if (!text || typeof text !== 'string') return { ok: true };
  
  // 띄어쓰기 및 특수문자 제거 후 검사
  const normalized = text.toLowerCase().replace(/[\s\-_.,!@#$%^&*()]/g, '');
  
  for (const word of BAD_WORDS) {
    if (text.includes(word) || normalized.includes(word)) {
      return {
        ok: false,
        word: word,
        message: '친구들과 함께 읽을 수 있는 고운 말로 바꿔 주세요.'
      };
    }
  }
  return { ok: true };
}

/**
 * 여러 필드를 한 번에 욕설 검사합니다.
 */
export function validateInputs(...texts) {
  for (const t of texts) {
    const result = checkBadWords(t);
    if (!result.ok) return result;
  }
  return { ok: true };
}

// 브라우저 기기 고유 ID 발급 및 보관 (localStorage)
export function getDeviceId() {
  const KEY = 'gwacheon_device_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = 'dev_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
    localStorage.setItem(KEY, id);
  }
  return id;
}

// 공감(좋아요) 중복 방지 (기기당 1회)
export function hasLiked(proposalId) {
  const liked = JSON.parse(localStorage.getItem('gwacheon_liked_proposals') || '[]');
  return liked.includes(proposalId);
}

export function markLiked(proposalId) {
  const liked = JSON.parse(localStorage.getItem('gwacheon_liked_proposals') || '[]');
  if (!liked.includes(proposalId)) {
    liked.push(proposalId);
    localStorage.setItem('gwacheon_liked_proposals', JSON.stringify(liked));
  }
}

// 학생 모둠 기억
export function getMyTeam() {
  return localStorage.getItem('gwacheon_my_team') || '';
}

export function setMyTeam(teamNumber) {
  localStorage.setItem('gwacheon_my_team', String(teamNumber));
}

// Firebase 설정 상태 확인
let activeFirebaseConfig = null;
let configChecked = false;

export async function getActiveFirebaseConfig() {
  if (configChecked) return activeFirebaseConfig;
  configChecked = true;

  // 1. AI Studio 자동 프로비저닝 설정 파일 확인
  try {
    const res = await fetch('/firebase-applet-config.json');
    if (res.ok) {
      const appletCfg = await res.json();
      if (appletCfg && appletCfg.apiKey && appletCfg.apiKey !== 'YOUR_API_KEY') {
        activeFirebaseConfig = appletCfg;
        return activeFirebaseConfig;
      }
    }
  } catch (e) {
    // 무시하고 수동 설정으로 넘어감
  }

  // 2. 수동 설정 파일(firebase-config.js) 확인
  if (
    firebaseConfig &&
    firebaseConfig.apiKey &&
    firebaseConfig.apiKey !== 'YOUR_API_KEY' &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== 'YOUR_PROJECT_ID'
  ) {
    activeFirebaseConfig = firebaseConfig;
    return activeFirebaseConfig;
  }

  activeFirebaseConfig = null;
  return null;
}

export function isFirebaseConfigured() {
  return Boolean(activeFirebaseConfig) || (
    firebaseConfig &&
    firebaseConfig.apiKey &&
    firebaseConfig.apiKey !== 'YOUR_API_KEY' &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== 'YOUR_PROJECT_ID'
  );
}

// ===================================================================
// Firebase 초기화 및 데이터 레이어
// Firebase 미설정 시 로컬 시뮬레이션(localStorage + BroadcastChannel) 자동 전환
// ===================================================================

let db = null;
let fbModule = null;
let isRealFirebase = false;

const broadcastChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('gwacheon_class_sync')
  : null;

// Firebase CDN 비동기 로더
async function initDataLayer() {
  if (db !== null) return;

  const cfg = await getActiveFirebaseConfig();

  if (cfg) {
    try {
      const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
      const firestore = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
      
      const app = initializeApp(cfg);
      db = cfg.firestoreDatabaseId
        ? firestore.getFirestore(app, cfg.firestoreDatabaseId)
        : firestore.getFirestore(app);
      fbModule = firestore;
      isRealFirebase = true;
      console.log('✅ Firebase Firestore 연결 완료:', cfg.projectId);
      return;
    } catch (err) {
      console.warn('⚠️ Firebase 연결 실패, 로컬 시뮬레이션 모드로 전환합니다:', err);
    }
  }

  // 로컬 시뮬레이터 모드
  isRealFirebase = false;
  console.log('💡 로컬 시뮬레이션 모드로 작동 중입니다. (Firebase 연결 시 클라우드 실시간 모드로 작동)');
}

// ===================================================================
// 1. 설문 응답 (responses) API
// ===================================================================

export async function addResponse({ location, issue, situation }) {
  await initDataLayer();
  
  if (isRealFirebase && db && fbModule) {
    try {
      const { collection, addDoc, serverTimestamp } = fbModule;
      const ref = await addDoc(collection(db, 'responses'), {
        location: location || '',
        issue: issue || '',
        situation: situation || '',
        ts: serverTimestamp()
      });
      return { id: ref.id, success: true };
    } catch (err) {
      console.error('Firebase 저장 실패:', err);
      throw err;
    }
  }

  // 로컬 시뮬레이터
  const localList = JSON.parse(localStorage.getItem('gwacheon_local_responses') || '[]');
  const newDoc = {
    id: 'resp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    location: location || '',
    issue: issue || '',
    situation: situation || '',
    ts: { seconds: Math.floor(Date.now() / 1000) }
  };
  localList.unshift(newDoc);
  localStorage.setItem('gwacheon_local_responses', JSON.stringify(localList));
  if (broadcastChannel) broadcastChannel.postMessage({ type: 'responses_updated' });
  return { id: newDoc.id, success: true };
}

export async function subscribeResponses(callback, onError) {
  await initDataLayer();

  if (isRealFirebase && db && fbModule) {
    try {
      const { collection, onSnapshot, query, orderBy } = fbModule;
      const q = query(collection(db, 'responses'), orderBy('ts', 'desc'));
      return onSnapshot(q, (snapshot) => {
        const list = [];
        snapshot.forEach(doc => {
          list.push({ id: doc.id, ...doc.data() });
        });
        callback(list);
      }, (err) => {
        console.error('responses 구독 에러:', err);
        if (onError) onError(err);
      });
    } catch (err) {
      console.warn('Firebase 구독 오류, 로컬 모드로 대체:', err);
    }
  }

  // 로컬 시뮬레이터 구독
  const notifyLocal = () => {
    const list = JSON.parse(localStorage.getItem('gwacheon_local_responses') || '[]');
    callback(list);
  };
  
  notifyLocal();

  const handleMessage = (e) => {
    if (e.data && e.data.type === 'responses_updated') {
      notifyLocal();
    }
  };

  const handleStorage = (e) => {
    if (e.key === 'gwacheon_local_responses') {
      notifyLocal();
    }
  };

  if (broadcastChannel) broadcastChannel.addEventListener('message', handleMessage);
  window.addEventListener('storage', handleStorage);

  return () => {
    if (broadcastChannel) broadcastChannel.removeEventListener('message', handleMessage);
    window.removeEventListener('storage', handleStorage);
  };
}

export async function clearAllResponses() {
  await initDataLayer();

  if (isRealFirebase && db && fbModule) {
    const { collection, getDocs, deleteDoc, doc } = fbModule;
    const snap = await getDocs(collection(db, 'responses'));
    const deletes = snap.docs.map(d => deleteDoc(doc(db, 'responses', d.id)));
    await Promise.all(deletes);
    return true;
  }

  // 로컬 시뮬레이터 초기화
  localStorage.removeItem('gwacheon_local_responses');
  if (broadcastChannel) broadcastChannel.postMessage({ type: 'responses_updated' });
  return true;
}

// ===================================================================
// 2. 제안하는 글 (proposals) API
// ===================================================================

export async function addProposal({ team, name, recipient, problem, proposal, reason1, reason2 }) {
  await initDataLayer();

  const payload = {
    team: parseInt(team, 10),
    name: String(name).trim(),
    recipient: String(recipient).trim(),
    problem: String(problem).trim(),
    proposal: String(proposal).trim(),
    reason1: String(reason1).trim(),
    reason2: reason2 ? String(reason2).trim() : '',
    likes: 0,
    submitted: true
  };

  if (isRealFirebase && db && fbModule) {
    try {
      const { collection, addDoc, serverTimestamp } = fbModule;
      const ref = await addDoc(collection(db, 'proposals'), {
        ...payload,
        ts: serverTimestamp()
      });
      return { id: ref.id, success: true };
    } catch (err) {
      console.error('Firebase 제안 등록 실패:', err);
      throw err;
    }
  }

  // 로컬 시뮬레이터
  const localList = JSON.parse(localStorage.getItem('gwacheon_local_proposals') || '[]');
  const newDoc = {
    id: 'prop_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    ...payload,
    ts: { seconds: Math.floor(Date.now() / 1000) }
  };
  localList.unshift(newDoc);
  localStorage.setItem('gwacheon_local_proposals', JSON.stringify(localList));
  if (broadcastChannel) broadcastChannel.postMessage({ type: 'proposals_updated' });
  return { id: newDoc.id, success: true };
}

export async function subscribeProposals(callback, onError) {
  await initDataLayer();

  if (isRealFirebase && db && fbModule) {
    try {
      const { collection, onSnapshot, query, orderBy } = fbModule;
      const q = query(collection(db, 'proposals'), orderBy('ts', 'desc'));
      return onSnapshot(q, (snapshot) => {
        const list = [];
        snapshot.forEach(doc => {
          list.push({ id: doc.id, ...doc.data() });
        });
        callback(list);
      }, (err) => {
        console.error('proposals 구독 에러:', err);
        if (onError) onError(err);
      });
    } catch (err) {
      console.warn('Firebase 구독 오류, 로컬 모드로 대체:', err);
    }
  }

  // 로컬 시뮬레이터 구독
  const notifyLocal = () => {
    const list = JSON.parse(localStorage.getItem('gwacheon_local_proposals') || '[]');
    callback(list);
  };

  notifyLocal();

  const handleMessage = (e) => {
    if (e.data && e.data.type === 'proposals_updated') {
      notifyLocal();
    }
  };

  const handleStorage = (e) => {
    if (e.key === 'gwacheon_local_proposals') {
      notifyLocal();
    }
  };

  if (broadcastChannel) broadcastChannel.addEventListener('message', handleMessage);
  window.addEventListener('storage', handleStorage);

  return () => {
    if (broadcastChannel) broadcastChannel.removeEventListener('message', handleMessage);
    window.removeEventListener('storage', handleStorage);
  };
}

export async function likeProposal(proposalId) {
  await initDataLayer();

  if (isRealFirebase && db && fbModule) {
    const { doc, runTransaction } = fbModule;
    const propRef = doc(db, 'proposals', proposalId);

    await runTransaction(db, async (transaction) => {
      const sfDoc = await transaction.get(propRef);
      if (!sfDoc.exists()) {
        throw new Error('해당 제안 글이 존재하지 않습니다.');
      }
      const newLikes = (sfDoc.data().likes || 0) + 1;
      transaction.update(propRef, { likes: newLikes });
    });
    return true;
  }

  // 로컬 시뮬레이터
  const localList = JSON.parse(localStorage.getItem('gwacheon_local_proposals') || '[]');
  const index = localList.findIndex(p => p.id === proposalId);
  if (index !== -1) {
    localList[index].likes = (localList[index].likes || 0) + 1;
    localStorage.setItem('gwacheon_local_proposals', JSON.stringify(localList));
    if (broadcastChannel) broadcastChannel.postMessage({ type: 'proposals_updated' });
    return true;
  }
  return false;
}

// ===================================================================
// 3. 댓글 (proposals/{id}/comments) API
// ===================================================================

export async function addComment(proposalId, { type, team, content }) {
  await initDataLayer();

  const payload = {
    type: type === 'improve' ? 'improve' : 'good',
    team: parseInt(team, 10),
    content: String(content).trim()
  };

  if (isRealFirebase && db && fbModule) {
    const { collection, addDoc, serverTimestamp } = fbModule;
    const commentsRef = collection(db, 'proposals', proposalId, 'comments');
    await addDoc(commentsRef, {
      ...payload,
      ts: serverTimestamp()
    });
    return true;
  }

  // 로컬 시뮬레이터
  const key = `gwacheon_comments_${proposalId}`;
  const list = JSON.parse(localStorage.getItem(key) || '[]');
  list.push({
    id: 'cmt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    ...payload,
    ts: { seconds: Math.floor(Date.now() / 1000) }
  });
  localStorage.setItem(key, JSON.stringify(list));
  if (broadcastChannel) broadcastChannel.postMessage({ type: 'comments_updated', proposalId });
  return true;
}

export async function subscribeComments(proposalId, callback, onError) {
  await initDataLayer();

  if (isRealFirebase && db && fbModule) {
    try {
      const { collection, onSnapshot, query, orderBy } = fbModule;
      const commentsRef = collection(db, 'proposals', proposalId, 'comments');
      const q = query(commentsRef, orderBy('ts', 'asc'));
      return onSnapshot(q, (snapshot) => {
        const list = [];
        snapshot.forEach(doc => {
          list.push({ id: doc.id, ...doc.data() });
        });
        callback(list);
      }, (err) => {
        console.error('comments 구독 에러:', err);
        if (onError) onError(err);
      });
    } catch (err) {
      console.warn('Firebase 댓글 구독 실패, 로컬 대체:', err);
    }
  }

  // 로컬 시뮬레이터
  const key = `gwacheon_comments_${proposalId}`;
  const notifyLocal = () => {
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    callback(list);
  };

  notifyLocal();

  const handleMessage = (e) => {
    if (e.data && e.data.type === 'comments_updated' && e.data.proposalId === proposalId) {
      notifyLocal();
    }
  };

  const handleStorage = (e) => {
    if (e.key === key) {
      notifyLocal();
    }
  };

  if (broadcastChannel) broadcastChannel.addEventListener('message', handleMessage);
  window.addEventListener('storage', handleStorage);

  return () => {
    if (broadcastChannel) broadcastChannel.removeEventListener('message', handleMessage);
    window.removeEventListener('storage', handleStorage);
  };
}

// ===================================================================
// UI 편의 함수 (토스트, 확인창, 음성 읽기)
// ===================================================================

export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'error' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

export function showConfirm(title, message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-modal-overlay';
  overlay.innerHTML = `
    <div class="confirm-modal">
      <h3>${title}</h3>
      <p>${message}</p>
      <div class="confirm-actions">
        <button class="btn btn-secondary" id="confirm-cancel-btn">취소</button>
        <button class="btn btn-danger" id="confirm-ok-btn">확인</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#confirm-cancel-btn').onclick = () => overlay.remove();
  overlay.querySelector('#confirm-ok-btn').onclick = () => {
    overlay.remove();
    onConfirm();
  };
}

// Web Speech API (글 소리 내어 읽기)
export function speakText(text) {
  if (!('speechSynthesis' in window)) {
    showToast('이 브라우저는 소리 내어 읽기 기능을 지원하지 않아요.', 'warning');
    return false;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ko-KR';
  utterance.rate = 0.95; // 초등학생에게 알맞은 또박또박한 속도
  utterance.pitch = 1.05;
  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

// 상단 설정 알림 배너 주입기
export async function injectConfigNotice() {
  const cfg = await getActiveFirebaseConfig();
  const existing = document.getElementById('app-config-notice');
  if (existing) existing.remove();

  if (!cfg) {
    const banner = document.createElement('div');
    banner.id = 'app-config-notice';
    banner.style.cssText = 'background: #eff6ff; border-bottom: 2px solid #bfdbfe; padding: 10px 16px; font-size: 0.88rem; color: #1e40af; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;';
    banner.innerHTML = `
      <div>
        <strong>💡 체험용 로컬 시뮬레이션 모드 작동 중:</strong>
        Firebase 연결 전에는 브라우저 내에서 테스트 가능하며, Firebase가 연결되면 모든 기기 간 실시간 공유가 활성화됩니다.
      </div>
    `;
    document.body.prepend(banner);
  } else {
    console.log('Firebase 활성화됨:', cfg.projectId);
  }
}
